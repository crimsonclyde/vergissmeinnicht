import type { Actor, DocumentFileFormat, DocumentFileId, DocumentId, TextSource, TextState, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** A file claimed for text recognition (16.9). `attempt` identifies this claim: a stale worker's writes are refused. */
export interface TextJob {
  readonly fileId: DocumentFileId;
  readonly workspaceId: WorkspaceId;
  readonly sha256: string;
  readonly format: DocumentFileFormat;
  readonly pageCount: number | null;
  readonly attempt: number;
}

/** What was read from a file: cleaned page texts joined by `PAGE_SEPARATOR`, and its folded form. */
export interface TextResult {
  readonly text: string;
  readonly searchText: string;
  readonly source: TextSource;
  readonly pages: number;
  readonly truncated: boolean;
}

export interface TextRecognitionSettings {
  readonly enabled: boolean;
  /** Files of the Workspace by state, so an admin sees what is waiting or failed. */
  readonly counts: Readonly<Record<TextState, number>>;
}

/**
 * The text-recognition queue and the recognised text (16.9): durable state in SQLite with atomic
 * claims, leases and bounded attempts (the 13.5 / 14.1 delivery pattern). A job is only claimed while
 * its Workspace has Documents and recognition switched on; a file is never processed twice at once.
 */
export interface DocumentTextRepository {
  /**
   * In one IMMEDIATE transaction: marks files whose attempts are used up as FAILED, then takes the next
   * QUEUED file — or a PROCESSING one whose lease expired (a crash) — new uploads before existing files,
   * oldest first; counts the attempt and sets a lease. A file whose identical content in the **same**
   * Workspace already has text gets a copy of it instead (never across Workspaces).
   */
  claim(now: Date, leaseMs: number, maxAttempts: number): Promise<TextJob | undefined>;
  /** Extends the lease between pages. False when the job is no longer this claim's, or recognition/Documents was switched off. */
  extend(job: TextJob, now: Date, leaseMs: number): Promise<boolean>;
  /** Stores the text if the claim is still current and it fits the Workspace's storage. */
  complete(job: TextJob, result: TextResult, now: Date): Promise<'ok' | 'lost' | 'paused' | 'storage_full'>;
  /** A failed attempt: QUEUED again at `retryAt`, or FAILED when `retryAt` is null. `code` is a stable code. */
  fail(job: TextJob, code: string, now: Date, retryAt: Date | null): Promise<void>;
  /**
   * Gives a claim back without counting it — recognition was switched off, the server stops, or (with
   * `wait`) the engine is unavailable: then the file waits until `wait.until` with that code.
   */
  release(job: TextJob, now: Date, wait?: { readonly until: Date; readonly code: string }): Promise<void>;
  /** Queues a FAILED file again with fresh attempts. */
  retry(input: { readonly workspaceId: WorkspaceId; readonly fileId: DocumentFileId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<'ok' | 'forbidden' | 'not_found' | 'not_failed'>;
  settings(workspaceId: WorkspaceId): Promise<TextRecognitionSettings>;
  /**
   * The text suggestions are read from (16.9 task 5): of the Document's first file (in page order)
   * whose text was read and is not empty, with that file's 1-based position. Live Documents only.
   */
  suggestionSource(workspaceId: WorkspaceId, documentId: DocumentId): Promise<{ readonly file: number; readonly text: string } | undefined>;
  /** Keys (`suggestionKey`) of suggestions dismissed on this Document. */
  dismissals(workspaceId: WorkspaceId, documentId: DocumentId): Promise<Set<string>>;
  /** Remembers one dismissed suggestion; the Document must be live in this Workspace. */
  dismiss(input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly key: string; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<'ok' | 'forbidden' | 'not_found'>;
  /** Switches recognition for the Workspace and records it in the audit history (only when it changes). */
  setEnabled(input: { readonly workspaceId: WorkspaceId; readonly enabled: boolean; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<'ok' | 'forbidden'>;
}

/**
 * Reads text from document files on this server only (HT9 / HT10) — no network connection. Each call
 * is bounded in time and memory and runs in a worker thread; failures throw with a stable `code`.
 */
export interface TextExtractor {
  /** The embedded text of one PDF page (0-based); '' when it has none. */
  pdfPageText(path: string, page: number): Promise<string>;
  /** OCR of one PDF page, drawn for recognition. */
  recognizePdfPage(path: string, page: number): Promise<string>;
  /** OCR of a JPEG or PNG. */
  recognizeImage(path: string): Promise<string>;
}

export class TextExtractionError extends Error {
  /** `unreadable` (the file), `too_complex` (time or memory ran out), `unavailable` (no engine or language data). */
  readonly code: 'unreadable' | 'too_complex' | 'unavailable';

  constructor(code: 'unreadable' | 'too_complex' | 'unavailable') {
    super(`text extraction: ${code}`);
    this.name = 'TextExtractionError';
    this.code = code;
  }
}
