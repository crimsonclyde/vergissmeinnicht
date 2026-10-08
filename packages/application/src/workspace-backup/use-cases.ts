import { canAuthenticate, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
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

/**
 * The background worker (in-process, like text recognition): one job at a time. On start it marks jobs a
 * stopped server left RUNNING as `interrupted` and removes their files; every pass also deletes expired
 * packages and leftovers of failed or cancelled jobs.
 */
export function createBackupRunner(deps: WorkspaceBackupDeps) {
  async function sweep(): Promise<void> {
    const now = deps.clock.now();
    for (const id of await deps.backupJobs.failInterrupted(now)) deps.backupStore.remove(id);
    for (const id of await deps.backupJobs.expire(now)) deps.backupStore.remove(id);
    for (const id of await deps.backupJobs.finishedBefore(now)) deps.backupStore.remove(id);
  }

  async function runOne(): Promise<boolean> {
    const now = deps.clock.now();
    const job = await deps.backupJobs.claimNext(now, new Date(now.getTime() + BACKUP_LEASE_MS));
    if (job === undefined) return false;
    if (job.kind !== 'EXPORT' || job.workspaceId === null) {
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
        await sweep();
        let ran = false;
        while (await runOne().catch(() => true)) ran = true;
        return ran;
      }, () => false);
      return queue;
    },
    sweep,
  };
}
