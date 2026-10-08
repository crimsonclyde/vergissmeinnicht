import { randomUUID } from 'node:crypto';
import type { BackupJob, BackupJobRepository, RestorePreview } from '@vergissmeinnicht/application';
import { DEFAULT_WORKSPACE_RESTORE_MAX_BYTES, type UserId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import type { Transaction } from './actor-guard.ts';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { instanceSettings, memberships, users, workspaceBackupJobs } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type Row = typeof workspaceBackupJobs.$inferSelect;

function json<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}


function jobOf(row: Row): BackupJob {
  const counts = json<Record<string, number>>(row.counts);
  return {
    id: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId as WorkspaceId | null,
    state: row.state,
    requestedByUserId: row.requestedByUserId as UserId,
    phase: row.phase,
    progressDone: row.progressDone,
    progressTotal: row.progressTotal,
    cancelRequested: row.cancelRequested,
    sizeBytes: row.sizeBytes,
    counts,
    preview: json<RestorePreview>(row.preview),
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
  };
}

/** Section 18 backup jobs. Creating an export re-checks the ADMIN membership in the transaction. */
export function createBackupJobRepository({ db }: Pick<AppDatabase, 'db'>): BackupJobRepository {
  const get = (id: string) => db.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, id)).get();
  return {
    async createExport(input, actor) {
      return db.transaction((tx) => {
        const member = tx
          .select({ role: memberships.role })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, actor.userId), eq(users.status, 'ACTIVE')))
          .get();
        if (member === undefined || !roleHasCapability(member.role, 'workspace.backup')) return { status: 'forbidden' as const };
        const running = tx
          .select({ id: workspaceBackupJobs.id })
          .from(workspaceBackupJobs)
          .where(and(eq(workspaceBackupJobs.workspaceId, input.workspaceId), eq(workspaceBackupJobs.kind, 'EXPORT'), inArray(workspaceBackupJobs.state, ['QUEUED', 'RUNNING'])))
          .get();
        if (running !== undefined) return { status: 'already_running' as const };
        const id = randomUUID();
        tx.insert(workspaceBackupJobs)
          .values({ id, kind: 'EXPORT', workspaceId: input.workspaceId, state: 'QUEUED', requestedByUserId: actor.userId, progressDone: 0, progressTotal: 0, cancelRequested: false, createdAt: input.at })
          .run();
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, id)).get();
        if (row === undefined) throw new Error('backup job vanished');
        return { status: 'ok' as const, job: jobOf(row) };
      }, IMMEDIATE);
    },

    async get(jobId) {
      const row = get(jobId);
      return row === undefined ? undefined : jobOf(row);
    },

    async listExports(workspaceId, limit) {
      return db
        .select()
        .from(workspaceBackupJobs)
        .where(and(eq(workspaceBackupJobs.workspaceId, workspaceId), eq(workspaceBackupJobs.kind, 'EXPORT')))
        .orderBy(desc(workspaceBackupJobs.createdAt), desc(workspaceBackupJobs.id))
        .limit(limit)
        .all()
        .map(jobOf);
    },

    async claimNext(at, leaseUntil) {
      return db.transaction((tx) => {
        const next = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.state, 'QUEUED')).orderBy(asc(workspaceBackupJobs.createdAt), asc(workspaceBackupJobs.id)).get();
        if (next === undefined) return undefined;
        tx.update(workspaceBackupJobs).set({ state: 'RUNNING', startedAt: at, leaseUntil }).where(and(eq(workspaceBackupJobs.id, next.id), eq(workspaceBackupJobs.state, 'QUEUED'))).run();
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, next.id)).get();
        return row === undefined ? undefined : jobOf(row);
      }, IMMEDIATE);
    },

    async progress(jobId, phase, done, total, leaseUntil) {
      db.update(workspaceBackupJobs).set({ phase, progressDone: done, progressTotal: total, leaseUntil }).where(and(eq(workspaceBackupJobs.id, jobId), eq(workspaceBackupJobs.state, 'RUNNING'))).run();
    },

    async completeExport(jobId, result) {
      db.transaction((tx) => {
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, jobId)).get();
        if (row === undefined || row.workspaceId === null) return;
        tx.update(workspaceBackupJobs)
          .set({ state: 'READY', phase: null, progressDone: result.sizeBytes, progressTotal: result.sizeBytes, sizeBytes: result.sizeBytes, counts: JSON.stringify(result.counts), finishedAt: result.at, expiresAt: result.expiresAt, leaseUntil: null })
          .where(eq(workspaceBackupJobs.id, jobId))
          .run();
        const requester = tx.select({ name: users.name }).from(users).where(eq(users.id, row.requestedByUserId)).get();
        recordSecurityEvent(tx, {
          type: 'WORKSPACE_BACKUP_EXPORTED',
          actor: { kind: 'user', userId: row.requestedByUserId, displayName: requester?.name ?? '' },
          subjectType: 'workspace',
          subjectId: row.workspaceId,
          occurredAt: result.at,
          metadata: { jobId, sizeBytes: result.sizeBytes, ...result.counts },
        });
      }, IMMEDIATE);
    },

    async fail(jobId, errorCode, at) {
      // A finished job (a completed export or restore) is never turned into a failure afterwards.
      db.update(workspaceBackupJobs).set({ state: 'FAILED', errorCode: errorCode.slice(0, 64), finishedAt: at, leaseUntil: null, preview: null }).where(and(eq(workspaceBackupJobs.id, jobId), ne(workspaceBackupJobs.state, 'READY'))).run();
    },

    async requestCancel(jobId, at) {
      return db.transaction((tx) => {
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, jobId)).get();
        if (row === undefined) return false;
        // A restore that has happened is history, not something to cancel (its Workspace exists).
        if (row.kind === 'RESTORE' && row.phase === 'restored') return false;
        if (row.state === 'QUEUED' || row.state === 'READY') {
          tx.update(workspaceBackupJobs).set({ state: 'CANCELLED', cancelRequested: true, finishedAt: at, expiresAt: null, preview: null }).where(eq(workspaceBackupJobs.id, jobId)).run();
          return true;
        }
        if (row.state === 'RUNNING') {
          tx.update(workspaceBackupJobs).set({ cancelRequested: true }).where(eq(workspaceBackupJobs.id, jobId)).run();
          return true;
        }
        return false;
      }, IMMEDIATE);
    },

    async markCancelled(jobId, at) {
      db.update(workspaceBackupJobs).set({ state: 'CANCELLED', finishedAt: at, leaseUntil: null, expiresAt: null, preview: null }).where(and(eq(workspaceBackupJobs.id, jobId), ne(workspaceBackupJobs.state, 'READY'))).run();
    },

    async failInterrupted(at) {
      return db.transaction((tx) => {
        const stale = tx.select({ id: workspaceBackupJobs.id }).from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.state, 'RUNNING'), lt(workspaceBackupJobs.leaseUntil, at))).all().map((row) => row.id);
        if (stale.length > 0) tx.update(workspaceBackupJobs).set({ state: 'FAILED', errorCode: 'interrupted', finishedAt: at, leaseUntil: null, preview: null }).where(inArray(workspaceBackupJobs.id, stale)).run();
        return stale;
      }, IMMEDIATE);
    },

    async expire(at) {
      return db.transaction((tx) => {
        const due = tx.select({ id: workspaceBackupJobs.id }).from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.state, 'READY'), lt(workspaceBackupJobs.expiresAt, at))).all().map((row) => row.id);
        // A restore's preview (previous members' names and addresses) goes with it.
        if (due.length > 0) tx.update(workspaceBackupJobs).set({ state: 'EXPIRED', preview: null }).where(inArray(workspaceBackupJobs.id, due)).run();
        return due;
      }, IMMEDIATE);
    },

    async finishedBefore(before) {
      return db
        .select({ id: workspaceBackupJobs.id })
        .from(workspaceBackupJobs)
        .where(and(inArray(workspaceBackupJobs.state, ['FAILED', 'CANCELLED', 'EXPIRED']), isNotNull(workspaceBackupJobs.finishedAt), lt(workspaceBackupJobs.finishedAt, before)))
        .all()
        .map((row) => row.id);
    },

    async recordDownload(jobId, actor, at) {
      db.transaction((tx) => {
        const row = tx.select({ workspaceId: workspaceBackupJobs.workspaceId, size: workspaceBackupJobs.sizeBytes }).from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, jobId)).get();
        if (row?.workspaceId === null || row === undefined) return;
        recordSecurityEvent(tx, { type: 'WORKSPACE_BACKUP_DOWNLOADED', actor, subjectType: 'workspace', subjectId: row.workspaceId, occurredAt: at, metadata: { jobId, sizeBytes: row.size ?? 0 } });
      }, IMMEDIATE);
    },

    async restoreMaxBytes() {
      return db.select({ bytes: instanceSettings.workspaceRestoreMaxBytes }).from(instanceSettings).where(eq(instanceSettings.id, 1)).get()?.bytes ?? DEFAULT_WORKSPACE_RESTORE_MAX_BYTES;
    },

    async createRestore(input, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return { status: 'forbidden' as const };
        // Restores holding files (uploading, waiting, validated and waiting for confirmation, restoring) are
        // limited server-wide, so uploads cannot pile up on the volume (D14).
        const open = tx
          .select({ id: workspaceBackupJobs.id })
          .from(workspaceBackupJobs)
          .where(
            and(
              eq(workspaceBackupJobs.kind, 'RESTORE'),
              or(inArray(workspaceBackupJobs.state, ['QUEUED', 'RUNNING']), and(eq(workspaceBackupJobs.state, 'READY'), eq(workspaceBackupJobs.phase, 'validated'))),
            ),
          )
          .all().length;
        if (open >= input.maxOpen) return { status: 'too_many' as const };
        const id = randomUUID();
        tx.insert(workspaceBackupJobs)
          .values({ id, kind: 'RESTORE', workspaceId: null, state: 'RUNNING', phase: 'upload', requestedByUserId: actor.userId, progressDone: 0, progressTotal: 0, cancelRequested: false, createdAt: input.at, startedAt: input.at, leaseUntil: input.leaseUntil })
          .run();
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, id)).get();
        if (row === undefined) throw new Error('backup job vanished');
        return { status: 'ok' as const, job: jobOf(row) };
      }, IMMEDIATE);
    },

    async restoreUploaded(jobId, sizeBytes, at) {
      db.transaction((tx) => {
        const row = tx.select().from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.id, jobId), eq(workspaceBackupJobs.kind, 'RESTORE'), eq(workspaceBackupJobs.state, 'RUNNING'), eq(workspaceBackupJobs.phase, 'upload'))).get();
        if (row === undefined) return;
        tx.update(workspaceBackupJobs).set({ state: 'QUEUED', phase: 'validate', sizeBytes, progressDone: 0, progressTotal: 0, leaseUntil: null }).where(eq(workspaceBackupJobs.id, jobId)).run();
        const requester = tx.select({ name: users.name }).from(users).where(eq(users.id, row.requestedByUserId)).get();
        recordSecurityEvent(tx, {
          type: 'WORKSPACE_RESTORE_UPLOADED',
          actor: { kind: 'user', userId: row.requestedByUserId, displayName: requester?.name ?? '' },
          subjectType: 'instance',
          subjectId: jobId,
          occurredAt: at,
          metadata: { jobId, sizeBytes },
        });
      }, IMMEDIATE);
    },

    async saveRestorePreview(jobId, preview, at, expiresAt) {
      db.update(workspaceBackupJobs)
        .set({ state: 'READY', phase: 'validated', preview: JSON.stringify(preview), finishedAt: at, expiresAt, leaseUntil: null })
        .where(and(eq(workspaceBackupJobs.id, jobId), eq(workspaceBackupJobs.kind, 'RESTORE'), eq(workspaceBackupJobs.state, 'RUNNING')))
        .run();
    },

    async confirmRestore(jobId, at) {
      const result = db
        .update(workspaceBackupJobs)
        .set({ state: 'QUEUED', phase: 'restore', progressDone: 0, progressTotal: 0, finishedAt: null, expiresAt: null })
        .where(
          and(
            eq(workspaceBackupJobs.id, jobId),
            eq(workspaceBackupJobs.kind, 'RESTORE'),
            eq(workspaceBackupJobs.state, 'READY'),
            eq(workspaceBackupJobs.phase, 'validated'),
            eq(workspaceBackupJobs.cancelRequested, false),
            gt(workspaceBackupJobs.expiresAt, at),
          ),
        )
        .run();
      return result.changes === 1;
    },

    async listRestores(limit) {
      return db.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.kind, 'RESTORE')).orderBy(desc(workspaceBackupJobs.createdAt), desc(workspaceBackupJobs.id)).limit(limit).all().map(jobOf);
    },
  };
}

/**
 * Completes a restore job inside the restore's own transaction (with the new Workspace): READY/`restored`, the
 * new Workspace's id, and WORKSPACE_RESTORED in the security log — so a committed restore is never reported as
 * failed, and a failed one never as done. Kept for `BACKUP_KEEP_MS`; its preview goes when it expires.
 */
export function completeRestoreIn(tx: Transaction, input: { readonly jobId: string; readonly workspaceId: string; readonly counts: Readonly<Record<string, number>>; readonly persons: number; readonly at: Date; readonly expiresAt: Date }): void {
  const row = tx.select().from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.id, input.jobId), eq(workspaceBackupJobs.kind, 'RESTORE'), eq(workspaceBackupJobs.state, 'RUNNING'))).get();
  // The job must still be the running, confirmed restore (phase `restore`, or one of its steps `restore-…`):
  // otherwise — failed as interrupted meanwhile, or never confirmed — nothing is committed.
  if (row === undefined || row.workspaceId !== null || (row.phase !== 'restore' && !row.phase?.startsWith('restore-'))) throw new Error('restore job is not running');
  tx.update(workspaceBackupJobs)
    .set({ state: 'READY', phase: 'restored', workspaceId: input.workspaceId, counts: JSON.stringify(input.counts), finishedAt: input.at, expiresAt: input.expiresAt, leaseUntil: null })
    .where(eq(workspaceBackupJobs.id, input.jobId))
    .run();
  const requester = tx.select({ name: users.name }).from(users).where(eq(users.id, row.requestedByUserId)).get();
  recordSecurityEvent(tx, {
    type: 'WORKSPACE_RESTORED',
    actor: { kind: 'user', userId: row.requestedByUserId, displayName: requester?.name ?? '' },
    subjectType: 'workspace',
    subjectId: input.workspaceId,
    occurredAt: input.at,
    metadata: { jobId: input.jobId, persons: input.persons, ...input.counts },
  });
}
