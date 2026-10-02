import { previewPageCount, type DocumentFileId } from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { DocumentFileProcessor, DocumentFileRecord, DocumentFileRepository, DocumentFileStore } from '../ports/document-files.ts';
import { storePreviewPage } from './files.ts';

/** A file's previews are tried this often (an attempt ends with READY, PARTIAL or FAILED). */
export const MAX_PREVIEW_ATTEMPTS = 3;

export interface PreviewQueue {
  /** Asks for the remaining preview pages of a file to be made. Returns at once. */
  enqueue(fileId: DocumentFileId): void;
  /** Picks up files whose previews were not finished (after a restart, or a failed attempt). */
  resume(): Promise<number>;
  /** Resolves when nothing is queued or running (tests, shutdown). */
  idle(): Promise<void>;
}

export interface PreviewDeps {
  readonly files: DocumentFileRepository;
  readonly store: DocumentFileStore;
  readonly processor: DocumentFileProcessor;
  readonly clock: Clock;
  /** Told about a failure with its error type only — never file names or contents. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Makes the preview pages of PDFs in the background (16.1): **one file at a time, page by page** — a
 * queue, never unbounded parallelism. What is still to do is the `PENDING` state of the file's row, so
 * the queue survives a restart (`resume`) without a second job store. Storing a page checks the
 * Workspace's storage limit; when it is full the file becomes `PARTIAL` and keeps what it has — the
 * original stays downloadable. The server is one process (modular monolith), so no claiming is needed.
 */
export function createPreviewQueue(deps: PreviewDeps): PreviewQueue {
  const queued: DocumentFileId[] = [];
  const known = new Set<DocumentFileId>();
  let working: Promise<void> | undefined;

  async function finish(file: DocumentFileRecord): Promise<void> {
    const pages = previewPageCount(file.format, file.pageCount);
    const path = await deps.store.locate(file.sha256);
    if (path === undefined) return deps.files.setPreviewState(file.id, 'FAILED', true);
    for (let page = 0; page < pages; page++) {
      if ((await deps.files.findDerivative(file.workspaceId, file.id, 'PREVIEW', page)) !== undefined) continue;
      const image = await deps.processor.renderPage(path, file.format, page);
      if (image === undefined) return deps.files.setPreviewState(file.id, 'FAILED', true);
      const stored = await storePreviewPage(deps, file.id, page, image);
      if (stored === 'gone') return;
      if (stored === 'storage_full') return deps.files.setPreviewState(file.id, 'PARTIAL', true);
    }
    return deps.files.setPreviewState(file.id, 'READY', true);
  }

  async function work(): Promise<void> {
    for (let fileId = queued.shift(); fileId !== undefined; fileId = queued.shift()) {
      known.delete(fileId);
      try {
        const file = await deps.files.findById(fileId);
        if (file !== undefined && file.previewState === 'PENDING') await finish(file);
      } catch (error) {
        deps.onError?.(error);
        // Counted as an attempt; `resume` tries again until the attempts are used up.
        await deps.files.setPreviewState(fileId, 'PENDING', true).catch(() => undefined);
      }
    }
    working = undefined;
  }

  const enqueue = (fileId: DocumentFileId) => {
    if (known.has(fileId)) return;
    known.add(fileId);
    queued.push(fileId);
    working ??= work();
  };

  return {
    enqueue,
    async resume() {
      const pending = await deps.files.pendingPreviews(MAX_PREVIEW_ATTEMPTS, 100);
      for (const file of pending) enqueue(file.id);
      return pending.length;
    },
    async idle() {
      while (working !== undefined) await working;
    },
  };
}
