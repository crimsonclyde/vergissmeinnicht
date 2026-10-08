import type { Actor, UserId, WorkspaceId } from '@vergissmeinnicht/domain';

export type BackupJobState = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

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
