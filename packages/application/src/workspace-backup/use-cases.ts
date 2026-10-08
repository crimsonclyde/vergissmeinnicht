import { canAuthenticate, isActiveServerAdmin, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import { WorkspaceBackupStoreError, type BackupJob, type BackupJobRepository, type WorkspaceBackupStore } from '../ports/workspace-backup.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

/** A finished package is kept this long, then deleted (D3). */
export const BACKUP_KEEP_MS = 24 * 60 * 60_000;
/** A running job holds its claim this long; renewed with every progress report. A server restart lets it lapse. */
export const BACKUP_LEASE_MS = 2 * 60_000;
/** How many recent exports the Backup page lists. */
export const BACKUP_LIST_LIMIT = 5;
/** How many recent restores the server administration lists. */
export const RESTORE_LIST_LIMIT = 10;

export class BackupAlreadyRunningError extends Error {
  constructor() {
    super('A backup of this Workspace is already being made');
    this.name = 'BackupAlreadyRunningError';
  }
}

export class BackupNotFoundError extends Error {
  constructor() {
    super('Backup not found');
    this.name = 'BackupNotFoundError';
  }
}

/** The restore cannot be confirmed: it is not waiting for confirmation (any more) — e.g. confirmed already. */
export class RestoreNotConfirmableError extends Error {
  constructor() {
    super('This restore is not waiting for confirmation');
    this.name = 'RestoreNotConfirmableError';
  }
}

export interface WorkspaceBackupDeps {
  readonly workspaces: WorkspaceRepository;
  readonly backupJobs: BackupJobRepository;
  readonly backupStore: WorkspaceBackupStore;
  readonly clock: Clock;
}

/** Workspace ADMIN only (B1); a non-member gets "not found" like any other Workspace route. */
async function enter(deps: WorkspaceBackupDeps, actor: User, workspaceId: WorkspaceId): Promise<void> {
  if (!canAuthenticate(actor)) throw new NotAuthorizedError();
  await authorizeWorkspace(deps, actor, workspaceId, 'workspace.backup');
}

/** An export job of this Workspace — never one of another Workspace, whatever id is asked for. */
async function ownJob(deps: WorkspaceBackupDeps, workspaceId: WorkspaceId, jobId: string): Promise<BackupJob> {
  const job = /^[0-9a-f-]{36}$/.test(jobId) ? await deps.backupJobs.get(jobId) : undefined;
  if (job === undefined || job.kind !== 'EXPORT' || job.workspaceId !== workspaceId) throw new BackupNotFoundError();
  return job;
}

/** Queues a backup of the Workspace (section 18a). The work happens in the background (`createBackupRunner`). */
export async function requestWorkspaceExport(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<BackupJob> {
  await enter(deps, input.actor, input.workspaceId);
  const result = await deps.backupJobs.createExport({ workspaceId: input.workspaceId, at: deps.clock.now() }, userActor(input.actor));
  if (result.status !== 'ok') throw result.status === 'forbidden' ? new NotAuthorizedError() : new BackupAlreadyRunningError();
  return result.job;
}

export async function listWorkspaceExports(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<BackupJob[]> {
  await enter(deps, input.actor, input.workspaceId);
  return deps.backupJobs.listExports(input.workspaceId, BACKUP_LIST_LIMIT);
}

export async function cancelWorkspaceExport(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly jobId: string }): Promise<BackupJob> {
  await enter(deps, input.actor, input.workspaceId);
  const job = await ownJob(deps, input.workspaceId, input.jobId);
  if (job.state === 'READY') {
    // Deleting a finished package early is the same as cancelling it: the file goes now.
    await deps.backupJobs.requestCancel(job.id, deps.clock.now());
    deps.backupStore.remove(job.id);
  } else {
    await deps.backupJobs.requestCancel(job.id, deps.clock.now());
  }
  return (await deps.backupJobs.get(job.id)) ?? job;
}

/**
 * The finished package for download: ADMIN re-checked now, this Workspace's job, READY and not expired.
 * Recorded as WORKSPACE_BACKUP_DOWNLOADED. There is no link that works without the session (D3).
 */
export async function openWorkspaceExport(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly jobId: string }): Promise<{ readonly path: string; readonly sizeBytes: number; readonly createdAt: Date }> {
  await enter(deps, input.actor, input.workspaceId);
  const job = await ownJob(deps, input.workspaceId, input.jobId);
  const now = deps.clock.now();
  const path = deps.backupStore.packagePath(job.id);
  if (job.state !== 'READY' || job.expiresAt === null || job.expiresAt.getTime() <= now.getTime() || path === undefined || job.sizeBytes === null) throw new BackupNotFoundError();
  await deps.backupJobs.recordDownload(job.id, userActor(input.actor), now);
  return { path, sizeBytes: job.sizeBytes, createdAt: job.finishedAt ?? job.createdAt };
}

// ---- Restore (18b): server admins only. A restore always creates a new Workspace and never touches another.

function enterRestore(actor: User): void {
  if (!isActiveServerAdmin(actor)) throw new NotAuthorizedError();
}

/** A restore job — any server admin may see and handle any restore (server administration). */
async function restoreJob(deps: WorkspaceBackupDeps, jobId: string): Promise<BackupJob> {
  const job = /^[0-9a-f-]{36}$/.test(jobId) ? await deps.backupJobs.get(jobId) : undefined;
  if (job === undefined || job.kind !== 'RESTORE') throw new BackupNotFoundError();
  return job;
}

/**
 * Receives a `.vmnbackup` for a restore (streamed into a private job folder, never buffered) and queues its
 * validation. A server stopped during the upload leaves an `interrupted` job; a refused upload keeps nothing.
 */
export async function uploadWorkspaceRestore(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly source: AsyncIterable<Uint8Array> }): Promise<BackupJob> {
  enterRestore(input.actor);
  const now = deps.clock.now();
  const created = await deps.backupJobs.createRestore({ at: now, leaseUntil: new Date(now.getTime() + BACKUP_LEASE_MS) }, userActor(input.actor));
  if (created.status !== 'ok') throw new NotAuthorizedError();
  const job = created.job;
  let lastReport = 0;
  try {
    const size = await deps.backupStore.receiveUpload(job.id, input.source, {
      maxBytes: await deps.backupJobs.restoreMaxBytes(),
      onProgress: (done) => {
        const at = Date.now();
        if (at - lastReport < 1000) return;
        lastReport = at;
        void deps.backupJobs.progress(job.id, 'upload', done, 0, new Date(deps.clock.now().getTime() + BACKUP_LEASE_MS));
      },
    });
    await deps.backupJobs.restoreUploaded(job.id, size, deps.clock.now());
  } catch (error) {
    deps.backupStore.remove(job.id);
    await deps.backupJobs.fail(job.id, error instanceof WorkspaceBackupStoreError ? error.code : 'upload_failed', deps.clock.now());
    throw error instanceof WorkspaceBackupStoreError ? error : new WorkspaceBackupStoreError('upload_failed');
  }
  return (await deps.backupJobs.get(job.id)) ?? job;
}

export async function listWorkspaceRestores(deps: WorkspaceBackupDeps, input: { readonly actor: User }): Promise<BackupJob[]> {
  enterRestore(input.actor);
  return deps.backupJobs.listRestores(RESTORE_LIST_LIMIT);
}

export async function getWorkspaceRestore(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly jobId: string }): Promise<BackupJob> {
  enterRestore(input.actor);
  return restoreJob(deps, input.jobId);
}

/** The explicit confirmation: exactly once per validated restore (a repeated or concurrent one is refused). */
export async function confirmWorkspaceRestore(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly jobId: string }): Promise<BackupJob> {
  enterRestore(input.actor);
  const job = await restoreJob(deps, input.jobId);
  if (!(await deps.backupJobs.confirmRestore(job.id, deps.clock.now()))) throw new RestoreNotConfirmableError();
  return (await deps.backupJobs.get(job.id)) ?? job;
}

/** Discards a restore before it happens (its upload is deleted); a completed restore is not undone this way. */
export async function cancelWorkspaceRestore(deps: WorkspaceBackupDeps, input: { readonly actor: User; readonly jobId: string }): Promise<BackupJob> {
  enterRestore(input.actor);
  const job = await restoreJob(deps, input.jobId);
  const cancelled = await deps.backupJobs.requestCancel(job.id, deps.clock.now());
  const current = (await deps.backupJobs.get(job.id)) ?? job;
  if (cancelled && current.state === 'CANCELLED') deps.backupStore.remove(job.id);
  return current;
}

/**
 * The background worker (in-process, like text recognition): one job at a time. On start it marks jobs a
 * stopped server left RUNNING as `interrupted` and removes their files; every pass also deletes expired
 * packages and leftovers of failed or cancelled jobs.
 */
export function createBackupRunner(deps: WorkspaceBackupDeps, options: { readonly onError?: (error: unknown) => void } = {}) {
  async function sweep(): Promise<void> {
    const now = deps.clock.now();
    for (const id of await deps.backupJobs.failInterrupted(now)) deps.backupStore.remove(id);
    for (const id of await deps.backupJobs.expire(now)) deps.backupStore.remove(id);
    for (const id of await deps.backupJobs.finishedBefore(now)) deps.backupStore.remove(id);
  }

  /** Progress with a renewed lease, throttled; also notices a cancellation request. */
  function reporter(jobId: string, onCancel: () => void) {
    let lastReport = 0;
    return (phase: string, done: number, total: number) => {
      const at = Date.now();
      if (at - lastReport < 500 && done < total) return;
      lastReport = at;
      void deps.backupJobs.progress(jobId, phase, done, total, new Date(deps.clock.now().getTime() + BACKUP_LEASE_MS));
      void deps.backupJobs.get(jobId).then((current) => {
        if (current?.cancelRequested === true) onCancel();
      });
    };
  }

  /**
   * A restore job: `validate` checks the upload completely and stores the preview; `restore` (after the explicit
   * confirmation) creates the Workspace. Either way the job's files are deleted when it ends unless it waits for
   * confirmation; a failure keeps nothing (files copied into the stores already are removed by housekeeping
   * once nothing references them).
   */
  async function runRestore(job: BackupJob): Promise<void> {
    let cancelled = false;
    const report = reporter(job.id, () => (cancelled = true));
    // Steps are recorded under the job's phase (`validate-extract`, `restore-records`, …): the phase itself says what the job is doing.
    const options = { isCancelled: () => cancelled, onProgress: (step: string, done: number, total: number) => report(`${job.phase ?? ''}-${step}`, done, total) };
    try {
      if (job.phase === 'validate') {
        const preview = await deps.backupStore.validateRestore(job, options);
        if ((await deps.backupJobs.get(job.id))?.cancelRequested === true) throw new WorkspaceBackupStoreError('cancelled');
        const at = deps.clock.now();
        await deps.backupJobs.saveRestorePreview(job.id, preview, at, new Date(at.getTime() + BACKUP_KEEP_MS));
      } else if (job.phase === 'restore') {
        await deps.backupStore.restore(job, options);
        deps.backupStore.remove(job.id);
      } else {
        throw new WorkspaceBackupStoreError('unsupported');
      }
    } catch (error) {
      deps.backupStore.remove(job.id);
      const at = deps.clock.now();
      if (cancelled || (await deps.backupJobs.get(job.id))?.cancelRequested === true) await deps.backupJobs.markCancelled(job.id, at);
      else await deps.backupJobs.fail(job.id, error instanceof WorkspaceBackupStoreError ? error.code : 'failed', at);
      if (!(error instanceof WorkspaceBackupStoreError)) throw error;
    }
  }

  async function runOne(): Promise<boolean> {
    const now = deps.clock.now();
    const job = await deps.backupJobs.claimNext(now, new Date(now.getTime() + BACKUP_LEASE_MS));
    if (job === undefined) return false;
    if (job.kind === 'RESTORE') {
      await runRestore(job);
      return true;
    }
    if (job.workspaceId === null) {
      await deps.backupJobs.fail(job.id, 'unsupported', deps.clock.now());
      return true;
    }
    let cancelled = false;
    let lastReport = 0;
    const isCancelled = () => cancelled;
    try {
      const result = await deps.backupStore.writeExport(
        { id: job.id, workspaceId: job.workspaceId },
        {
          isCancelled,
          onProgress: (phase, done, total) => {
            const at = Date.now();
            if (at - lastReport < 500 && done < total) return;
            lastReport = at;
            const clock = deps.clock.now();
            void deps.backupJobs.progress(job.id, phase, done, total, new Date(clock.getTime() + BACKUP_LEASE_MS));
            void deps.backupJobs.get(job.id).then((current) => {
              if (current?.cancelRequested === true) cancelled = true;
            });
          },
        },
      );
      const finished = deps.clock.now();
      const current = await deps.backupJobs.get(job.id);
      if (current?.cancelRequested === true) {
        deps.backupStore.remove(job.id);
        await deps.backupJobs.markCancelled(job.id, finished);
        return true;
      }
      await deps.backupJobs.completeExport(job.id, { ...result, at: finished, expiresAt: new Date(finished.getTime() + BACKUP_KEEP_MS) });
    } catch (error) {
      deps.backupStore.remove(job.id);
      const at = deps.clock.now();
      if (cancelled || (await deps.backupJobs.get(job.id))?.cancelRequested === true) await deps.backupJobs.markCancelled(job.id, at);
      else await deps.backupJobs.fail(job.id, error instanceof WorkspaceBackupStoreError ? error.code : 'failed', at);
      if (!(error instanceof WorkspaceBackupStoreError) && !cancelled) throw error;
    }
    return true;
  }

  let queue: Promise<boolean> = Promise.resolve(false);
  return {
    /**
     * Runs queued jobs until none is left. Calls are serialized: a call made while a pass runs waits for it
     * and then makes its own pass, so the returned promise settles once the work it asked for is done.
     */
    wake(): Promise<boolean> {
      queue = queue.then(async () => {
        // Never fails the caller (and never takes the server down): e.g. while migrations are pending the
        // jobs table may not be there yet — the server stays up and reports itself not ready (12.x).
        try {
          await sweep();
          let ran = false;
          // An error ends this pass (the next wake, at the latest the minute tick, goes on): a failure that
          // repeats — e.g. claiming itself fails — must not turn into an endless loop.
          while (
            await runOne().catch((error: unknown) => {
              options.onError?.(error);
              return false;
            })
          )
            ran = true;
          return ran;
        } catch (error) {
          options.onError?.(error);
          return false;
        }
      }, () => false);
      return queue;
    },
    sweep,
  };
}
