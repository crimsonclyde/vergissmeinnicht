import {
  MAX_OCR_PAGES,
  MAX_TEXT_ATTEMPTS,
  MAX_TEXT_PAGES,
  cleanRecognizedText,
  hasUsableEmbeddedText,
  joinPageTexts,
  parseDocumentFileId,
  recognizedSearchText,
  type TextSource,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { DocumentFileStore } from '../ports/document-files.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import { TextExtractionError, type DocumentTextRepository, type TextExtractor, type TextJob, type TextRecognitionSettings, type TextResult } from '../ports/document-texts.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { DocumentFileNotFoundError } from './errors.ts';
import { authorizeTool } from './tools.ts';

/** A claim is held this long and extended after every page; a crashed worker's file is picked up again after it. */
export const TEXT_LEASE_MS = 10 * 60_000;
/** A failed attempt is tried again after this long (then after twice as long). */
export const TEXT_RETRY_MS = 5 * 60_000;
/** How often the server looks at the queue when nothing woke it (retries that became due, a restart). */
export const TEXT_POLL_MS = 60_000;

export interface TextRecognitionDeps {
  readonly texts: DocumentTextRepository;
  readonly store: DocumentFileStore;
  readonly extractor: TextExtractor;
  readonly clock: Clock;
  /** Told about a failure with its error type and code only — never file names or contents. */
  readonly onError?: (error: unknown) => void;
}

export interface TextRecognizer {
  /** Looks for work now (after an upload, a Retry or switching recognition on). Returns at once. */
  wake(): void;
  /** Resolves when nothing is running (tests). */
  idle(): Promise<void>;
  /** Stops after the current page; a claimed file is given back. */
  stop(): Promise<void>;
}

class Released extends Error {}

/**
 * Reads the text of one claimed file, page by page: a PDF page's embedded text when it has enough
 * (HT10), OCR otherwise (HT9) — at most `MAX_OCR_PAGES` pages by OCR and `MAX_TEXT_PAGES` in all. The
 * lease is extended after every page; when it cannot be (recognition or Documents switched off, or the
 * claim lost) the work stops.
 */
async function read(deps: TextRecognitionDeps, job: TextJob, path: string, stopping: () => boolean): Promise<TextResult> {
  const pages: string[] = [];
  let embedded = 0;
  let recognized = 0;
  let truncated = false;
  const keep = async () => {
    if (stopping() || !(await deps.texts.extend(job, deps.clock.now(), TEXT_LEASE_MS))) throw new Released();
  };
  if (job.format === 'PDF') {
    const total = job.pageCount ?? 0;
    const count = Math.min(total, MAX_TEXT_PAGES);
    truncated = total > count;
    for (let page = 0; page < count; page++) {
      await keep();
      const own = cleanRecognizedText(await deps.extractor.pdfPageText(path, page));
      if (hasUsableEmbeddedText(own)) {
        pages.push(own);
        embedded++;
      } else if (recognized < MAX_OCR_PAGES) {
        pages.push(cleanRecognizedText(await deps.extractor.recognizePdfPage(path, page)));
        recognized++;
      } else {
        pages.push(own);
        truncated = true;
      }
    }
  } else {
    await keep();
    pages.push(cleanRecognizedText(await deps.extractor.recognizeImage(path)));
    recognized++;
  }
  const text = joinPageTexts(pages);
  const source: TextSource = text.trim() === '' ? 'NONE' : embedded > 0 && recognized > 0 ? 'MIXED' : embedded > 0 ? 'EMBEDDED' : 'OCR';
  return { text, searchText: recognizedSearchText(text), source, pages: pages.length, truncated: truncated || text.length < pages.join('\f').length };
}

/**
 * Text recognition in the background (16.9): **one file at a time** — OCR needs about 255 MB and
 * seconds per page (HT9) — taken from the durable queue in SQLite, so it survives restarts and never
 * processes a file twice at once (atomic claim, lease, bounded attempts). Runs only while the file's
 * Workspace has Documents and recognition switched on (P5). Makes no network connection.
 */
export function createTextRecognizer(deps: TextRecognitionDeps): TextRecognizer {
  let working: Promise<void> | undefined;
  let again = false;
  let stopped = false;

  async function one(job: TextJob): Promise<void> {
    const path = await deps.store.locate(job.sha256);
    if (path === undefined) return deps.texts.fail(job, 'missing', deps.clock.now(), null);
    try {
      const result = await read(deps, job, path, () => stopped);
      // Switched off just before the end: the file waits, without using up an attempt.
      if ((await deps.texts.complete(job, result, deps.clock.now())) === 'paused') await deps.texts.release(job, deps.clock.now());
    } catch (error) {
      if (error instanceof Released) return deps.texts.release(job, deps.clock.now());
      deps.onError?.(error);
      const code = error instanceof TextExtractionError ? error.code : 'failed';
      const now = deps.clock.now();
      // Missing language data is the server's problem, not the file's: it waits without using up attempts.
      if (code === 'unavailable') return deps.texts.release(job, now, { until: new Date(now.getTime() + TEXT_RETRY_MS), code });
      const last = job.attempt >= MAX_TEXT_ATTEMPTS;
      await deps.texts.fail(job, code, now, last ? null : new Date(now.getTime() + TEXT_RETRY_MS * job.attempt));
    }
  }

  async function work(): Promise<void> {
    do {
      again = false;
      for (let job = await deps.texts.claim(deps.clock.now(), TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS); job !== undefined; job = stopped ? undefined : await deps.texts.claim(deps.clock.now(), TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS)) {
        // Stopping between the claim and the work gives the file back instead of leaving it to its lease.
        if (stopped) await deps.texts.release(job, deps.clock.now());
        else await one(job);
      }
    } while (again && !stopped);
  }

  function wake(): void {
    if (stopped) return;
    if (working !== undefined) {
      again = true;
      return;
    }
    working = work()
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        working = undefined;
      });
  }

  return {
    wake,
    async idle() {
      while (working !== undefined) await working;
    },
    async stop() {
      stopped = true;
      while (working !== undefined) await working;
    },
  };
}

export interface TextRecognitionUseCaseDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly texts: DocumentTextRepository;
  readonly recognizer: Pick<TextRecognizer, 'wake'>;
  readonly clock: Clock;
}

export class TextRetryNotPossibleError extends Error {
  constructor() {
    super('Only text recognition that failed can be tried again');
    this.name = 'TextRetryNotPossibleError';
  }
}

/** Retry for a file whose text could not be read (`document.manage`, like any change to a Document's files). */
export async function retryTextRecognition(deps: TextRecognitionUseCaseDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly fileId: string }): Promise<void> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  const fileId = parseDocumentFileId(input.fileId);
  const result = await deps.texts.retry({ workspaceId: input.workspaceId, fileId, at: deps.clock.now() }, userActor(input.actor), {
    tool: 'DOCUMENTS',
    actorMay: (role) => roleHasCapability(role, 'document.manage'),
  });
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'not_found') throw new DocumentFileNotFoundError();
  if (result === 'not_failed') throw new TextRetryNotPossibleError();
  deps.recognizer.wake();
}

/** Whether recognition is on, and how many files are in each state — for Workspace admins (P5). */
export async function textRecognitionSettings(deps: TextRecognitionUseCaseDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<TextRecognitionSettings> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'workspace.settings.manage');
  return deps.texts.settings(input.workspaceId);
}

/**
 * A Workspace admin switches text recognition on or off for the whole Workspace (P5). Off stops new
 * work (a running file stops at its next page) and keeps text already read; on also processes the
 * existing files, behind new uploads. Audited.
 */
export async function setTextRecognition(deps: TextRecognitionUseCaseDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly enabled: boolean }): Promise<TextRecognitionSettings> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'workspace.settings.manage');
  const result = await deps.texts.setEnabled({ workspaceId: input.workspaceId, enabled: input.enabled, at: deps.clock.now() }, userActor(input.actor), {
    tool: 'DOCUMENTS',
    actorMay: (role) => roleHasCapability(role, 'workspace.settings.manage'),
  });
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (input.enabled) deps.recognizer.wake();
  return deps.texts.settings(input.workspaceId);
}
