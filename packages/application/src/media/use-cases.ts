import { parseStepImageId, type StepImageId, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { ImageProcessor, ImageRepository, ImageUsage, MediaStore, StepImageRecord } from '../ports/media.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { StorageFullError } from '../documents/errors.ts';
import { ImageNotFoundError } from './errors.ts';

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
    { actorMay: (role) => roleHasCapability(role, 'procedure.edit') },
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
