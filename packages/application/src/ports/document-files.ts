import type { Actor, DerivativeKind, DocumentFileFormat, DocumentFileId, PreviewState, StorageUsage, TextState, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** Why a file was refused — stable codes for messages; never the file's content or name. */
export const DOCUMENT_FILE_REJECTIONS = [
  'too_large',
  'empty',
  'unsupported_format',
  'format_not_allowed',
  'too_many_pixels',
  'unreadable',
  'suspicious_content',
  'too_complex',
] as const;
export type DocumentFileRejection = (typeof DOCUMENT_FILE_REJECTIONS)[number];

export class DocumentFileRejectedError extends Error {
  readonly code: DocumentFileRejection;

  constructor(code: DocumentFileRejection) {
    super('The file was refused');
    this.name = 'DocumentFileRejectedError';
    this.code = code;
  }
}

/** An upload received into the store's private staging area: complete, hashed, not yet a stored file. */
export interface StagedFile {
  /** Where the bytes are while they are inspected (inside the store, never a name from the upload). */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Moves the file into the store (a no-op if identical content is already there). */
  commit(): Promise<void>;
  /** Removes the staged bytes. Safe to call after `commit`. */
  discard(): Promise<void>;
}

/**
 * Immutable, content-addressed files of Documents: originals exactly as uploaded, and their derived
 * previews. Names are SHA-256 hashes — never user-supplied names — and a hash is never a URL or a
 * capability. A file is only ever removed by housekeeping.
 */
export interface DocumentFileStore {
  /**
   * Receives an upload while counting and hashing it. Throws `DocumentFileRejectedError('too_large')`
   * as soon as more than `maxBytes` arrived (nothing is kept) and `'empty'` for no bytes at all.
   */
  stage(source: AsyncIterable<Uint8Array>, maxBytes: number): Promise<StagedFile>;
  /** Stores derived bytes (a preview) and returns their SHA-256. */
  put(bytes: Uint8Array): Promise<string>;
  /** Path of a stored file for reading, or undefined when missing. */
  locate(sha256: string): Promise<string | undefined>;
  /** A stream of a stored file, or undefined when missing. */
  open(sha256: string): Promise<{ readonly stream: AsyncIterable<Uint8Array>; readonly bytes: number } | undefined>;
  remove(sha256: string): Promise<void>;
  /** Every stored file with its modification time (for housekeeping). */
  list(): Promise<{ readonly sha256: string; readonly modifiedAt: Date }[]>;
  /** Removes staged uploads left behind by a crash (older than `before`). */
  sweepStaged(before: Date): Promise<number>;
}

/** What the content of an accepted file turned out to be. */
export interface InspectedFile {
  readonly format: DocumentFileFormat;
  /** Pages of a PDF (null when it is password-protected); 1 for an image. */
  readonly pageCount: number | null;
  /** Pixel size of an image; null for a PDF. */
  readonly width: number | null;
  readonly height: number | null;
  /** A PDF that cannot be opened without a password: kept, download only, no preview. */
  readonly encrypted: boolean;
  /** A PDF carrying JavaScript or embedded files (e.g. an e-invoice's XML): previews are plain images of its pages. */
  readonly activeContent: boolean;
}

/** An inert, metadata-free JPEG derived from an original. */
export interface RenderedImage {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Identifies and validates a file from its content (the name and the declared type are never
 * trusted) and derives previews. Bounded in pixels, pages, time and concurrency. `inspect` throws
 * `DocumentFileRejectedError`; `renderPage` returns undefined when no preview can be made.
 */
export interface DocumentFileProcessor {
  inspect(path: string, bytes: number): Promise<InspectedFile>;
  /** The preview of one page (0-based; always 0 for an image). */
  renderPage(path: string, format: DocumentFileFormat, page: number): Promise<RenderedImage | undefined>;
  /** A small version of an already derived preview. */
  thumbnail(preview: Uint8Array): Promise<RenderedImage>;
}

export interface DocumentFileRecord {
  readonly id: DocumentFileId;
  readonly workspaceId: WorkspaceId;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: DocumentFileFormat;
  readonly originalName: string;
  readonly pageCount: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly encrypted: boolean;
  readonly activeContent: boolean;
  readonly previewState: PreviewState;
  /** Preview pages that exist (PDF: of `pageCount`, at most 500). */
  readonly previewPages: number;
  /** Text recognition (16.9); null when nothing was queued for this file. */
  readonly textState: TextState | null;
  readonly uploadedByUserId: string;
  readonly uploadedByName: string;
  readonly uploadedAt: Date;
}

export interface DerivativeRecord {
  readonly kind: DerivativeKind;
  readonly page: number;
  readonly sha256: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/** The combined storage of the Workspace and its limit (16.4): Documents share it with instruction images. */
export type DocumentStorageUsage = StorageUsage;

export type RegisterDocumentFileResult =
  | { readonly status: 'ok'; readonly file: DocumentFileRecord; readonly usage: DocumentStorageUsage }
  | { readonly status: 'forbidden' }
  | { readonly status: 'tool_disabled' }
  | { readonly status: 'storage_full'; readonly usage: DocumentStorageUsage };

/**
 * Metadata of document files per Workspace. Every lookup is scoped by the Workspace id; storage usage
 * is computed inside the writing transaction (never a counter that could drift).
 */
export interface DocumentFileRepository {
  /**
   * In one IMMEDIATE transaction: re-checks the guard, checks the Workspace's combined usage + bytes
   * against its limit (identical content already in the Workspace costs nothing more) and inserts the row.
   */
  register(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly sha256: string;
      readonly bytes: number;
      readonly originalName: string;
      readonly inspected: InspectedFile;
      readonly previewState: PreviewState;
      readonly at: Date;
    },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<RegisterDocumentFileResult>;
  find(workspaceId: WorkspaceId, fileId: DocumentFileId): Promise<DocumentFileRecord | undefined>;
  /** For background work only (previews): never used to answer a request. */
  findById(fileId: DocumentFileId): Promise<DocumentFileRecord | undefined>;
  /** Background previews run only while their Workspace's Documents tool is enabled. */
  previewAllowed(fileId: DocumentFileId): Promise<boolean>;
  findDerivative(workspaceId: WorkspaceId, fileId: DocumentFileId, kind: DerivativeKind, page: number): Promise<DerivativeRecord | undefined>;
  usage(workspaceId: WorkspaceId, now: Date): Promise<DocumentStorageUsage>;
  /**
   * Adds a derived file (no-op when that page already has one). 'storage_full' when it does not fit:
   * previews stop, the original stays readable. 'gone' when the file no longer exists.
   */
  addDerivative(fileId: DocumentFileId, derivative: DerivativeRecord, at: Date): Promise<'ok' | 'storage_full' | 'gone' | 'paused'>;
  /** Records how far the previews are; counts an attempt when `attempted`. */
  setPreviewState(fileId: DocumentFileId, state: PreviewState, attempted: boolean): Promise<void>;
  /**
   * Files whose previews are still to be made, oldest first. Files that stayed PENDING after
   * `maxAttempts` attempts are marked FAILED instead of being returned.
   */
  pendingPreviews(maxAttempts: number, limit: number): Promise<DocumentFileRecord[]>;
  /**
   * Housekeeping: deletes rows of files that nothing references and that were uploaded before `before`
   * (with their derivative rows); returns the hashes no row uses any more.
   */
  purgeUnreferenced(before: Date): Promise<string[]>;
  /** Every SHA-256 used by a row — originals and derivatives. */
  usedHashes(): Promise<Set<string>>;
}

/** What the instance admin allows for document files (H8; the allow-list can only be narrowed). */
export interface DocumentFilePolicy {
  readonly maxFileBytes: number;
  readonly formats: readonly DocumentFileFormat[];
}
