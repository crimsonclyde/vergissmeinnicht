import type { Actor, UserId, WorkspaceId } from '@vergissmeinnicht/domain';

export type BackupJobState = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

/**
 * What a restore would create (18b), found by validating the whole package and performing the restore once
 * without committing it — shown before the server admin confirms. Previous members are listed for re-inviting
 * by hand; nobody is invited, matched or notified.
 */
export interface RestorePreview {
  readonly workspaceName: string;
  readonly sourceAppVersion: string;
  readonly databaseLevel: string;
  readonly createdAt: string;
  readonly packageBytes: number;
  /** Sum of the package's entries (records and originals) as extracted. */
  readonly contentBytes: number;
  readonly counts: Readonly<Record<string, number>>;
  /** Historical identities the restore creates. */
  readonly persons: number;
  readonly previousMembers: readonly { readonly displayName: string; readonly email: string | null; readonly role: string }[];
  readonly warnings: readonly string[];
  readonly schedulesPaused: number;
  readonly assignmentsCleared: number;
  readonly storage: { readonly used: number; readonly limit: number; readonly images: number; readonly imageLimit: number };
}

/** A Workspace backup job (section 18) — status only; the package is a file in the data volume. */
export interface BackupJob {
  readonly id: string;
  readonly kind: 'EXPORT' | 'RESTORE';
  readonly workspaceId: WorkspaceId | null;
  readonly state: BackupJobState;
  readonly requestedByUserId: UserId;
  readonly phase: string | null;
  readonly progressDone: number;
  readonly progressTotal: number;
  readonly cancelRequested: boolean;
  readonly sizeBytes: number | null;
  readonly counts: Readonly<Record<string, number>> | null;
  /** RESTORE: what validation found (until the job expires). */
  readonly preview: RestorePreview | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly expiresAt: Date | null;
}

type UserActor = Extract<Actor, { kind: 'user' }>;

export interface BackupJobRepository {
  /**
   * Queues an export. Re-checks in the transaction that the actor is an ACTIVE ADMIN of the Workspace;
   * refuses a second export while one is queued or running (one per Workspace).
   */
  createExport(input: { readonly workspaceId: WorkspaceId; readonly at: Date }, actor: UserActor): Promise<{ readonly status: 'ok'; readonly job: BackupJob } | { readonly status: 'forbidden' | 'already_running' }>;
  get(jobId: string): Promise<BackupJob | undefined>;
  listExports(workspaceId: WorkspaceId, limit: number): Promise<BackupJob[]>;
  /** The oldest queued job, now RUNNING with a lease. */
  claimNext(at: Date, leaseUntil: Date): Promise<BackupJob | undefined>;
  progress(jobId: string, phase: string, done: number, total: number, leaseUntil: Date): Promise<void>;
  /** READY with size, counts and expiry; records WORKSPACE_BACKUP_EXPORTED (who requested it, size, counts — never content). */
  completeExport(jobId: string, result: { readonly sizeBytes: number; readonly counts: Readonly<Record<string, number>>; readonly at: Date; readonly expiresAt: Date }): Promise<void>;
  fail(jobId: string, errorCode: string, at: Date): Promise<void>;
  /** Asks a queued or running job to stop; a queued one is cancelled at once. False = nothing to cancel. */
  requestCancel(jobId: string, at: Date): Promise<boolean>;
  markCancelled(jobId: string, at: Date): Promise<void>;
  /** RUNNING jobs whose lease ran out (the server stopped while they ran): FAILED `interrupted`; returns their ids. */
  failInterrupted(at: Date): Promise<string[]>;
  /** READY packages past their expiry: EXPIRED; returns their ids (their files are deleted by the caller). */
  expire(at: Date): Promise<string[]>;
  /** Jobs whose folders may be removed: finished more than `before` ago and not READY. */
  finishedBefore(before: Date): Promise<string[]>;
  recordDownload(jobId: string, actor: UserActor, at: Date): Promise<void>;

  // ---- Restore (18b): server admins only; a restore always creates a new Workspace.
  /** The upload limit for a restore (instance setting, D4). */
  restoreMaxBytes(): Promise<number>;
  /**
   * Starts a restore for an upload: RUNNING in phase `upload` with a lease (renewed while bytes arrive), so a
   * server stopped mid-upload leaves an `interrupted` job. Re-checks an ACTIVE server admin in the transaction.
   */
  createRestore(input: { readonly at: Date; readonly leaseUntil: Date }, actor: UserActor): Promise<{ readonly status: 'ok'; readonly job: BackupJob } | { readonly status: 'forbidden' }>;
  /** The upload is complete: QUEUED for validation; records WORKSPACE_RESTORE_UPLOADED. */
  restoreUploaded(jobId: string, sizeBytes: number, at: Date): Promise<void>;
  /** Validation passed: READY in phase `validated`, waiting for confirmation until `expiresAt`. */
  saveRestorePreview(jobId: string, preview: RestorePreview, at: Date, expiresAt: Date): Promise<void>;
  /**
   * Confirms a validated restore exactly once: READY/`validated` and not expired → QUEUED/`restore`, in one
   * conditional update. False when it is not (any more) waiting — a second or concurrent confirmation.
   */
  confirmRestore(jobId: string, at: Date): Promise<boolean>;
  listRestores(limit: number): Promise<BackupJob[]>;
}

/** Writes and holds the packages (infrastructure: the data volume). */
export interface WorkspaceBackupStore {
  /** Writes the package for an export job; refuses when the volume lacks the space (`insufficient_space`). */
  writeExport(
    job: { readonly id: string; readonly workspaceId: WorkspaceId },
    options: { readonly onProgress: (phase: string, done: number, total: number) => void; readonly isCancelled: () => boolean },
  ): Promise<{ readonly sizeBytes: number; readonly counts: Readonly<Record<string, number>> }>;
  /** The finished package, if it is there. */
  packagePath(jobId: string): string | undefined;
  /** Removes everything of a job (staging, package, partial files). Never throws for a missing folder. */
  remove(jobId: string): void;
  /**
   * Receives a restore upload into the job's private folder, counting while it streams: more than `maxBytes`,
   * or more than the volume can hold, fails (`too_large`, `insufficient_space`) — nothing is kept then.
   */
  receiveUpload(jobId: string, source: AsyncIterable<Uint8Array>, options: { readonly maxBytes: number; readonly onProgress: (done: number) => void }): Promise<number>;
  /** Validates the uploaded package completely and checks the restore without committing it. */
  validateRestore(
    job: { readonly id: string; readonly requestedByUserId: UserId },
    options: { readonly onProgress: (phase: string, done: number, total: number) => void; readonly isCancelled: () => boolean },
  ): Promise<RestorePreview>;
  /**
   * Restores the validated package into a new Workspace: originals into the content-addressed stores (bytes
   * verified), then one transaction that also completes the job — so a restore is either complete or absent.
   */
  restore(
    job: { readonly id: string; readonly requestedByUserId: UserId },
    options: { readonly onProgress: (phase: string, done: number, total: number) => void; readonly isCancelled: () => boolean },
  ): Promise<{ readonly workspaceId: WorkspaceId }>;
}

/** A failure of the package writer with a stable, user-facing reason. */
export class WorkspaceBackupStoreError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Workspace backup: ${code}`);
    this.name = 'WorkspaceBackupStoreError';
    this.code = code;
  }
}
