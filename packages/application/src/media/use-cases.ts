import { parseStepImageId, type StepImageId, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { GalleryCursor, GalleryImage, ImageProcessor, ImageRepository, ImageUsage, ImageUse, MediaStore, StepImageRecord } from '../ports/media.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { StorageFullError } from '../documents/errors.ts';
import { InvalidProcedureReferenceError } from '../procedures/errors.ts';
import { ImageInUseError, ImageNotFoundError } from './errors.ts';

export interface ImageDeps {
  readonly workspaces: WorkspaceRepository;
  readonly images: ImageRepository;
  readonly store: MediaStore;
  readonly processor: ImageProcessor;
  readonly clock: Clock;
}

/**
 * An upload not yet used by a saved Step still counts for this long (so uploads cannot bypass the
 * quota) and is removed by housekeeping afterwards. Longer than any backup run, so a database
 * snapshot never references a file that was just deleted.
 */
export const IMAGE_PENDING_MS = 24 * 60 * 60_000;

const pendingSince = (now: Date) => new Date(now.getTime() - IMAGE_PENDING_MS);

/**
 * Uploads an instruction image (14.3): needs `procedure.edit`. The upload is validated and processed on
 * the server (never trusted: content-based format check, pixel limit, orientation, metadata removed,
 * ≤1600 px, JPEG ≤500 KB); only the processed JPEG is stored, content-addressed. The quota check and
 * the metadata row happen in one transaction, so concurrent uploads cannot exceed it. The quota is the
 * Workspace's combined storage limit (16.4), shared with Documents.
 * `replacing`: the image this upload replaces on a Step (not counted when only Steps still use it).
 */
export async function uploadStepImage(
  deps: ImageDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly bytes: Uint8Array; readonly replacing?: string | undefined },
): Promise<{ readonly image: StepImageRecord; readonly usage: ImageUsage }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const replacing = input.replacing === undefined ? null : parseStepImageId(input.replacing);
  const processed = await deps.processor.process(input.bytes);
  const sha256 = await deps.store.put(processed.jpeg);
  const now = deps.clock.now();
  const result = await deps.images.register(
    {
      workspaceId: input.workspaceId,
      sha256,
      bytes: processed.jpeg.byteLength,
      width: processed.width,
      height: processed.height,
      at: now,
      pendingSince: pendingSince(now),
      replacing,
    },
    userActor(input.actor),
    { tool: 'PROCEDURES' as const, actorMay: (role) => roleHasCapability(role, 'procedure.edit') },
  );
  // A refused upload leaves only an unreferenced file behind; housekeeping removes it.
  if (result.status === 'forbidden') throw new NotAuthorizedError();
  if (result.status === 'quota_exceeded') throw new StorageFullError(result.usage);
  return { image: result.image, usage: result.usage };
}

/**
 * The bytes of an image of the Workspace: needs `procedure.view` there — also for content-addressed
 * files, whose hash is never a capability. Images of Run snapshots are served the same way.
 */
export async function readStepImage(deps: ImageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly imageId: string }): Promise<Uint8Array> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const record = await deps.images.find(input.workspaceId, parseStepImageId(input.imageId) as StepImageId);
  if (record === undefined) throw new ImageNotFoundError();
  const bytes = await deps.store.read(record.sha256);
  if (bytes === undefined) throw new ImageNotFoundError();
  return bytes;
}

/** Photos per gallery page (23.1). */
export const GALLERY_PAGE_SIZE = 48;
/** Longest edge of a gallery thumbnail (23.1). */
export const THUMBNAIL_EDGE = 320;
/** Longest gallery search text. */
export const MAX_GALLERY_SEARCH_LENGTH = 100;

/**
 * The Workspace's photo gallery (23.1): the photos a Step may use, newest first. Only for people who
 * may edit Procedures (`procedure.edit`) — they are the ones who pick photos. Answers like an unknown
 * resource for another Workspace or when Procedures is switched off (`authorizeWorkspace`).
 */
export async function listWorkspaceImages(
  deps: ImageDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly search?: string | undefined; readonly unused?: boolean | undefined; readonly after?: GalleryCursor | undefined },
): Promise<{ readonly images: readonly GalleryImage[]; readonly next: GalleryCursor | null }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const search = (input.search ?? '').trim().slice(0, MAX_GALLERY_SEARCH_LENGTH);
  return deps.images.gallery(input.workspaceId, {
    pendingSince: pendingSince(deps.clock.now()),
    search: search === '' ? null : search,
    unused: input.unused === true,
    after: input.after ?? null,
    limit: GALLERY_PAGE_SIZE,
  });
}

/** Where a photo of the Workspace is used: current Procedure Steps (`procedure.edit`, 23.1). */
export async function listImageUses(deps: ImageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly imageId: string }): Promise<readonly ImageUse[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const imageId = parseStepImageId(input.imageId) as StepImageId;
  if ((await deps.images.find(input.workspaceId, imageId)) === undefined) throw new ImageNotFoundError();
  return deps.images.uses(input.workspaceId, imageId);
}

/**
 * Replace a photo everywhere (23.2, owner decision SG3): every Step of a current Procedure of the
 * Workspace that shows `imageId` shows `replacement` instead — one transaction, a new revision and an
 * audit event per changed Procedure. Runs keep the photo of their Start; deleted Procedures are left as
 * they were. Same permission as editing one Procedure (`procedure.edit`). The replacement must be a
 * photo of this Workspace a Step may use (uploaded first through `uploadStepImage`).
 */
export async function replaceStepImageEverywhere(
  deps: ImageDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly imageId: string; readonly replacement: string },
): Promise<{ readonly procedures: number; readonly steps: number }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const from = parseStepImageId(input.imageId) as StepImageId;
  const to = parseStepImageId(input.replacement) as StepImageId;
  const now = deps.clock.now();
  const result = await deps.images.replaceEverywhere(
    { workspaceId: input.workspaceId, from, to, at: now, pendingSince: pendingSince(now) },
    userActor(input.actor),
    { tool: 'PROCEDURES' as const, actorMay: (role) => roleHasCapability(role, 'procedure.edit') },
  );
  switch (result.status) {
    case 'ok':
      return { procedures: result.procedures, steps: result.steps };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ImageNotFoundError();
    case 'invalid_reference':
      throw new InvalidProcedureReferenceError();
  }
}

/**
 * Delete a photo from the Workspace gallery (23.4): `procedure.edit`, like replacing it. Only a photo no
 * current Procedure Step shows; Runs keep theirs (`kept`), history is never changed.
 */
export async function removeStepImage(deps: ImageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly imageId: string }): Promise<{ readonly kept: boolean }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const imageId = parseStepImageId(input.imageId) as StepImageId;
  const result = await deps.images.remove({ workspaceId: input.workspaceId, imageId, at: deps.clock.now() }, userActor(input.actor), {
    tool: 'PROCEDURES' as const,
    actorMay: (role) => roleHasCapability(role, 'procedure.edit'),
  });
  switch (result.status) {
    case 'ok':
      return { kept: result.kept };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ImageNotFoundError();
    case 'in_use':
      throw new ImageInUseError();
  }
}

/**
 * Thumbnails by content hash: stored images never change under a hash, so a thumbnail made once stays
 * right. Bounded (oldest first out); only ever filled and read after the Workspace check.
 */
const THUMBNAIL_CACHE_ENTRIES = 300;
const thumbnails = new Map<string, Promise<Uint8Array>>();

function cachedThumbnail(sha256: string, make: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const known = thumbnails.get(sha256);
  if (known !== undefined) {
    thumbnails.delete(sha256);
    thumbnails.set(sha256, known); // most recently used last
    return known;
  }
  const made = make();
  thumbnails.set(sha256, made);
  made.catch(() => thumbnails.delete(sha256));
  while (thumbnails.size > THUMBNAIL_CACHE_ENTRIES) {
    const oldest = thumbnails.keys().next().value;
    if (oldest === undefined) break;
    thumbnails.delete(oldest);
  }
  return made;
}

/**
 * A small version of an image of the Workspace (23.1), with exactly the access rule of the image itself
 * (`procedure.view`). Made on demand from the stored JPEG and kept in memory only; the full image is
 * served when no thumbnail can be made.
 */
export async function readStepImageThumbnail(deps: ImageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly imageId: string }): Promise<Uint8Array> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const record = await deps.images.find(input.workspaceId, parseStepImageId(input.imageId) as StepImageId);
  if (record === undefined) throw new ImageNotFoundError();
  const bytes = await deps.store.read(record.sha256);
  if (bytes === undefined) throw new ImageNotFoundError();
  const thumbnail = deps.processor.thumbnail;
  if (thumbnail === undefined || Math.max(record.width, record.height) <= THUMBNAIL_EDGE) return bytes;
  try {
    return await cachedThumbnail(record.sha256, () => thumbnail.call(deps.processor, bytes, THUMBNAIL_EDGE));
  } catch {
    return bytes;
  }
}

/** The Workspace's combined storage and its limit, as far as an author needs it (used and limit). */
export async function imageUsage(deps: ImageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ImageUsage> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.images.usage(input.workspaceId, pendingSince(deps.clock.now()));
}

/**
 * Housekeeping (hourly): image rows referenced by nothing for longer than the grace period are deleted,
 * then files no row uses, and orphan files (e.g. of refused uploads) older than the grace period.
 * A file still referenced is never deleted.
 */
export async function purgeUnusedImages(deps: Pick<ImageDeps, 'images' | 'store' | 'clock'>): Promise<{ readonly files: number }> {
  const before = pendingSince(deps.clock.now());
  const released = await deps.images.purgeUnreferenced(before);
  for (const sha256 of released) await deps.store.remove(sha256);
  const used = await deps.images.usedHashes();
  let orphans = 0;
  for (const file of await deps.store.list()) {
    if (!used.has(file.sha256) && file.modifiedAt.getTime() < before.getTime() && !released.includes(file.sha256)) {
      await deps.store.remove(file.sha256);
      orphans++;
    }
  }
  return { files: released.length + orphans };
}
