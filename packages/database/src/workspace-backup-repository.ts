import { randomUUID } from 'node:crypto';
import type { BackupJob, BackupJobRepository } from '@vergissmeinnicht/application';
import type { UserId, WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { and, asc, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { memberships, users, workspaceBackupJobs } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type Row = typeof workspaceBackupJobs.$inferSelect;

function jobOf(row: Row): BackupJob {
  let counts: Record<string, number> | null = null;
  if (row.counts !== null) {
    try {
      counts = JSON.parse(row.counts) as Record<string, number>;
    } catch {
      counts = null;
    }
  }
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
      db.update(workspaceBackupJobs).set({ state: 'FAILED', errorCode: errorCode.slice(0, 64), finishedAt: at, leaseUntil: null }).where(eq(workspaceBackupJobs.id, jobId)).run();
    },

    async requestCancel(jobId, at) {
      return db.transaction((tx) => {
        const row = tx.select().from(workspaceBackupJobs).where(eq(workspaceBackupJobs.id, jobId)).get();
        if (row === undefined) return false;
        if (row.state === 'QUEUED' || row.state === 'READY') {
          tx.update(workspaceBackupJobs).set({ state: 'CANCELLED', cancelRequested: true, finishedAt: at, expiresAt: null }).where(eq(workspaceBackupJobs.id, jobId)).run();
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
      db.update(workspaceBackupJobs).set({ state: 'CANCELLED', finishedAt: at, leaseUntil: null, expiresAt: null }).where(eq(workspaceBackupJobs.id, jobId)).run();
    },

    async failInterrupted(at) {
      return db.transaction((tx) => {
        const stale = tx.select({ id: workspaceBackupJobs.id }).from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.state, 'RUNNING'), lt(workspaceBackupJobs.leaseUntil, at))).all().map((row) => row.id);
        if (stale.length > 0) tx.update(workspaceBackupJobs).set({ state: 'FAILED', errorCode: 'interrupted', finishedAt: at, leaseUntil: null }).where(inArray(workspaceBackupJobs.id, stale)).run();
        return stale;
      }, IMMEDIATE);
    },

    async expire(at) {
      return db.transaction((tx) => {
        const due = tx.select({ id: workspaceBackupJobs.id }).from(workspaceBackupJobs).where(and(eq(workspaceBackupJobs.state, 'READY'), lt(workspaceBackupJobs.expiresAt, at))).all().map((row) => row.id);
        if (due.length > 0) tx.update(workspaceBackupJobs).set({ state: 'EXPIRED' }).where(inArray(workspaceBackupJobs.id, due)).run();
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
  };
}
