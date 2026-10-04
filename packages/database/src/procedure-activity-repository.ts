import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import type { ProcedureActivity, ProcedureActivityRepository } from '@vergissmeinnicht/application';
import type { ProcedureId, RunId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { IMMEDIATE } from './actor-guard.ts';
import { toolEnabled } from './tool-policy.ts';
import { activeIn } from './procedure-repository.ts';
import { memberships, users, procedurePins, procedures, runs } from './schema.ts';

export function createProcedureActivityRepository({ db }: Pick<AppDatabase, 'db'>): ProcedureActivityRepository {
  return {
    async pin(input) {
      return db.transaction((tx) => {
      if (!toolEnabled(tx, input.workspaceId, 'PROCEDURES') || tx.select({ id: memberships.userId }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId), eq(users.status, 'ACTIVE'))).get() === undefined) return false;
      const procedure = tx.select({ id: procedures.id }).from(procedures).where(activeIn(input.workspaceId, input.procedureId)).get();
      if (procedure === undefined) return false;
      tx.insert(procedurePins)
        .values({ userId: input.userId, procedureId: procedure.id, workspaceId: input.workspaceId, pinnedAt: input.at })
        .onConflictDoNothing()
        .run();
      return true;
      }, IMMEDIATE);
    },

    async unpin(userId, workspaceId, procedureId) {
      return db.transaction((tx) => {
      if (!toolEnabled(tx, workspaceId, 'PROCEDURES') || tx.select({ id: memberships.userId }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), eq(users.status, 'ACTIVE'))).get() === undefined) return false;
      if (tx.select({ id: procedures.id }).from(procedures).where(activeIn(workspaceId, procedureId)).get() === undefined) return false;
      tx.delete(procedurePins)
        .where(and(eq(procedurePins.userId, userId), eq(procedurePins.workspaceId, workspaceId), eq(procedurePins.procedureId, procedureId)))
        .run();
      return true;
      }, IMMEDIATE);
    },

    async pinnedIds(userId, workspaceId) {
      return db
        .select({ id: procedurePins.procedureId })
        .from(procedurePins)
        .innerJoin(procedures, and(eq(procedures.id, procedurePins.procedureId), eq(procedures.workspaceId, workspaceId), isNull(procedures.deletedAt)))
        .where(and(eq(procedurePins.userId, userId), eq(procedurePins.workspaceId, workspaceId)))
        .orderBy(asc(procedurePins.pinnedAt))
        .all()
        .map((row) => row.id as ProcedureId);
    },

    async recentIds(userId, workspaceId, limit) {
      if (limit <= 0) return [];
      const lastStarted = max(runs.startedAt);
      return db
        .select({ id: runs.procedureId, lastStarted })
        .from(runs)
        .innerJoin(procedures, and(eq(procedures.id, runs.procedureId), isNull(procedures.deletedAt)))
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.startedByUserId, userId)))
        .groupBy(runs.procedureId)
        .orderBy(desc(lastStarted))
        .limit(limit)
        .all()
        .map((row) => row.id as ProcedureId);
    },

    async activity(workspaceId) {
      const result = new Map<ProcedureId, { lastCompletedAt: Date | null; active: { runId: RunId; startedBy: string; startedAt: Date }[] }>();
      const entry = (id: string) => {
        let found = result.get(id as ProcedureId);
        if (found === undefined) {
          found = { lastCompletedAt: null, active: [] };
          result.set(id as ProcedureId, found);
        }
        return found;
      };
      const completed = db
        .select({ id: runs.procedureId, at: max(runs.endedAt) })
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.state, 'COMPLETED')))
        .groupBy(runs.procedureId)
        .all();
      for (const row of completed) entry(row.id).lastCompletedAt = row.at;
      const active = db
        .select({ id: runs.procedureId, runId: runs.id, startedBy: runs.startedByDisplayName, startedAt: runs.startedAt })
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.state, 'ACTIVE')))
        .orderBy(asc(runs.startedAt))
        .all();
      for (const row of active) entry(row.id).active.push({ runId: row.runId as RunId, startedBy: row.startedBy, startedAt: row.startedAt });
      return result as ReadonlyMap<ProcedureId, ProcedureActivity>;
    },
  };
}
