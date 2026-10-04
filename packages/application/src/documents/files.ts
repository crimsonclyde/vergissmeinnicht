import {
  DOCUMENT_FILE_TYPES,
  downloadFileName,
  normalizeOriginalFileName,
  parseDocumentFileId,
  previewPageCount,
  type DocumentFileId,
  type PreviewState,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import {
  DocumentFileRejectedError,
  type DocumentFilePolicy,
  type DocumentFileProcessor,
  type DocumentFileRecord,
  type DocumentFileRepository,
  type DocumentFileStore,
  type DocumentStorageUsage,
  type RenderedImage,
} from '../ports/document-files.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { DocumentFileNotFoundError, StorageFullError, TooManyUploadsError, ToolNotEnabledError } from './errors.ts';
import type { PreviewQueue } from './previews.ts';
import { authorizeTool } from './tools.ts';

export interface DocumentFileDeps {
  readonly workspaces: WorkspaceRepository;
  /** Document files exist only where the Documents tool is switched on (16.2). */
  readonly tools: WorkspaceToolRepository;
  readonly files: DocumentFileRepository;
  readonly store: DocumentFileStore;
  readonly processor: DocumentFileProcessor;
  /** What the instance admin allows right now (size limit, formats). */
  readonly policy: () => Promise<DocumentFilePolicy>;
  readonly previews: PreviewQueue;
  readonly clock: Clock;
}

/**
 * An upload not (or no longer) part of a Document is kept for this long after it was uploaded and then
 * removed by housekeeping; becoming a page of a Document (16.2) is what makes it permanent. Longer
 * than any backup run, so a database snapshot never references a file that was just deleted (as 14.3).
 */
export const DOCUMENT_FILE_PENDING_MS = 24 * 60 * 60_000;

/** Uploads one person may have running at the same time. */
export const MAX_PARALLEL_UPLOADS_PER_USER = 3;
const running = new Map<string, number>();

async function withUploadSlot<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const current = running.get(userId) ?? 0;
  if (current >= MAX_PARALLEL_UPLOADS_PER_USER) throw new TooManyUploadsError();
  running.set(userId, current + 1);
  try {
    return await task();
  } finally {
    const left = (running.get(userId) ?? 1) - 1;
    if (left <= 0) running.delete(userId);
    else running.set(userId, left);
  }
}

async function storeDerivative(deps: Pick<DocumentFileDeps, 'files' | 'store' | 'clock'>, fileId: DocumentFileId, kind: 'PREVIEW' | 'THUMBNAIL', page: number, image: RenderedImage) {
  const sha256 = await deps.store.put(image.jpeg);
  return deps.files.addDerivative(fileId, { kind, page, sha256, bytes: image.jpeg.byteLength, width: image.width, height: image.height }, deps.clock.now());
}

/** Stores the preview of one page and, for the first page, the thumbnail made from it. */
export async function storePreviewPage(
  deps: Pick<DocumentFileDeps, 'files' | 'store' | 'processor' | 'clock'>,
  fileId: DocumentFileId,
  page: number,
  preview: RenderedImage,
): Promise<'ok' | 'storage_full' | 'gone' | 'paused'> {
  const stored = await storeDerivative(deps, fileId, 'PREVIEW', page, preview);
  if (stored !== 'ok' || page !== 0) return stored;
  return storeDerivative(deps, fileId, 'THUMBNAIL', 0, await deps.processor.thumbnail(preview.jpeg));
}

/**
 * Uploads one file for a Document (16.1): needs `document.manage`. The bytes are received into the
 * store while they are counted and hashed (the size limit cuts the upload off), then identified and
 * validated from their content — name and declared type are never trusted. The **original is stored
 * exactly as received**: nothing is re-encoded, rotated or stripped. The first page is rendered right
 * away, which proves the file can be processed; a file that cannot be is refused and nothing is kept.
 * Quota check and metadata row are one transaction. Remaining PDF pages are previewed in the background.
 * Not an audit event: the upload is provisional until the file is added to a Document, and that is audited.
 */
export async function uploadDocumentFile(
  deps: DocumentFileDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly name: string; readonly source: AsyncIterable<Uint8Array> },
): Promise<{ readonly file: DocumentFileRecord; readonly usage: DocumentStorageUsage }> {
  // Authorised before a single byte is accepted.
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  const originalName = normalizeOriginalFileName(input.name);
  const policy = await deps.policy();
  return withUploadSlot(input.actor.id, async () => {
    const staged = await deps.store.stage(input.source, policy.maxFileBytes);
    try {
      const inspected = await deps.processor.inspect(staged.path, staged.bytes);
      if (!policy.formats.includes(inspected.format)) throw new DocumentFileRejectedError('format_not_allowed');
      const pages = previewPageCount(inspected.format, inspected.pageCount);
      const first = pages === 0 ? undefined : await deps.processor.renderPage(staged.path, inspected.format, 0);
      // An image or PDF the server cannot draw is refused. A password-protected PDF and a HEIC the
      // decoder cannot read are still valid files of their format: kept, download only.
      if (first === undefined && pages > 0 && inspected.format !== 'HEIC') throw new DocumentFileRejectedError('unreadable');
      const previewState: PreviewState = first === undefined ? 'NONE' : 'PENDING';
      await staged.commit();
      const result = await deps.files.register(
        { workspaceId: input.workspaceId, sha256: staged.sha256, bytes: staged.bytes, originalName, inspected, previewState, at: deps.clock.now() },
        userActor(input.actor),
        { actorMay: (role) => roleHasCapability(role, 'document.manage') },
      );
      // A refused upload leaves only an unreferenced file behind; housekeeping removes it.
      if (result.status === 'forbidden') throw new NotAuthorizedError();
      if (result.status === 'tool_disabled') throw new ToolNotEnabledError();
      if (result.status === 'storage_full') throw new StorageFullError(result.usage);
      let state: PreviewState = previewState;
      if (first !== undefined) {
        const stored = await storePreviewPage(deps, result.file.id, 0, first);
        state = stored === 'paused' ? 'PENDING' : stored === 'storage_full' ? 'PARTIAL' : pages > 1 ? 'PENDING' : 'READY';
        if (state !== 'PENDING') await deps.files.setPreviewState(result.file.id, state, true);
        else deps.previews.enqueue(result.file.id);
      }
      const file = await deps.files.find(input.workspaceId, result.file.id);
      await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
      return { file: file ?? { ...result.file, previewState: state }, usage: await deps.files.usage(input.workspaceId, deps.clock.now()) };
    } finally {
      await staged.discard();
    }
  });
}

async function findFile(deps: DocumentFileDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly fileId: string }): Promise<DocumentFileRecord> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  const record = await deps.files.find(input.workspaceId, parseDocumentFileId(input.fileId));
  if (record === undefined) throw new DocumentFileNotFoundError();
  return record;
}

/** A file's facts (format, pages, preview progress, who uploaded it): needs `document.view` in that Workspace. */
export async function getDocumentFile(deps: DocumentFileDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly fileId: string }): Promise<DocumentFileRecord> {
  return findFile(deps, input);
}

export interface OpenedFile {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly bytes: number;
  readonly contentType: string;
}

/**
 * The original, byte for byte: needs `document.view` (guests included, H4). It is only ever offered as
 * a download — with the content type of the **detected** format and a name generated by the server.
 * The storage name (hash) is never accepted in place of the id.
 */
export async function openOriginal(
  deps: DocumentFileDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly fileId: string },
): Promise<OpenedFile & { readonly fileName: string }> {
  const record = await findFile(deps, input);
  const opened = await deps.store.open(record.sha256);
  if (opened === undefined) throw new DocumentFileNotFoundError();
  return { ...opened, contentType: DOCUMENT_FILE_TYPES[record.format].contentType, fileName: downloadFileName(record.originalName, record.format) };
}

/** A preview page or the thumbnail — derived, inert JPEGs — under the same authorisation as the original. */
export async function openDerivative(
  deps: DocumentFileDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly fileId: string; readonly kind: 'PREVIEW' | 'THUMBNAIL'; readonly page: number },
): Promise<OpenedFile> {
  const record = await findFile(deps, input);
  const derivative = await deps.files.findDerivative(input.workspaceId, record.id, input.kind, input.page);
  const opened = derivative === undefined ? undefined : await deps.store.open(derivative.sha256);
  if (opened === undefined) throw new DocumentFileNotFoundError();
  return { ...opened, contentType: 'image/jpeg' };
}

/** The Workspace's combined storage and its limit (every member who can see Documents; the breakdown by tool is for admins — `workspaceStorage`). */
export async function documentStorageUsage(deps: DocumentFileDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<DocumentStorageUsage> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  return deps.files.usage(input.workspaceId, deps.clock.now());
}

/**
 * Housekeeping (hourly): rows of files that nothing references for longer than the grace period are
 * deleted with their previews, then files no row uses, orphan files (refused uploads) and staged
 * uploads a crash left behind. A file still referenced is never deleted.
 */
export async function purgeUnusedDocumentFiles(deps: Pick<DocumentFileDeps, 'files' | 'store' | 'clock'>): Promise<{ readonly files: number }> {
  const before = new Date(deps.clock.now().getTime() - DOCUMENT_FILE_PENDING_MS);
  const released = await deps.files.purgeUnreferenced(before);
  for (const sha256 of released) await deps.store.remove(sha256);
  const used = await deps.files.usedHashes();
  let orphans = 0;
  for (const file of await deps.store.list()) {
    if (!used.has(file.sha256) && file.modifiedAt.getTime() < before.getTime() && !released.includes(file.sha256)) {
      await deps.store.remove(file.sha256);
      orphans++;
    }
  }
  const staged = await deps.store.sweepStaged(before);
  return { files: released.length + orphans + staged };
}
