import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { addDays, localDateAt, type LocalDate, type TimeZoneName } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import type { TodayProgress, TodayRepository } from '@vergissmeinnicht/application';
import type { AppDatabase } from './connection.ts';
import { enabledScheduleSource, toolEnabled } from './tool-policy.ts';
import { memberships, occurrenceRuns, occurrences, procedures, runs, schedules, users } from './schema.ts';

/** Counts are SQL aggregates; activity reads at most ten of each source, with all filters before LIMIT. */
export function createTodayRepository({ db, sqlite }: Pick<AppDatabase, 'db' | 'sqlite'>): TodayRepository {
  sqlite.function('vmn_local_date', { deterministic: true }, (at, zone) => localDateAt(new Date(Number(at)), String(zone) as TimeZoneName));
  return {
    async read(input) {
      const today = localDateAt(input.now, 'UTC' as TimeZoneName);
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const weekFrom = addDays(today, -(weekday + 6) % 7);
      const weekTo = addDays(weekFrom, 6);
      const from = new Date(`${weekFrom}T00:00:00Z`);
      const until = new Date(`${addDays(weekTo, 1)}T00:00:00Z`);
      return db.transaction((tx): TodayProgress => {
        // Re-evaluate membership and tools in the query's transaction, not from a browser or cache.
        const member = tx.select({ role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId), eq(users.status, 'ACTIVE'))).get();
        const proceduresOn = member !== undefined && roleHasCapability(member.role, 'run.view') && toolEnabled(tx, input.workspaceId, 'PROCEDURES');
        const schedulesOn = member !== undefined && roleHasCapability(member.role, 'procedure.view') && (proceduresOn || toolEnabled(tx, input.workspaceId, 'REMINDERS'));
        const responsible = sql`coalesce(${occurrences.assigneeUserId}, ${schedules.assigneeUserId})`;
        const scope: SQL = input.filter === 'ALL' ? sql`1` : input.filter === 'MINE' ? sql`${responsible} = ${input.userId}` : sql`${responsible} is null`;
        const occurrenceWhere = and(eq(occurrences.workspaceId, input.workspaceId), enabledScheduleSource, scope);
        const occurrenceQuery = () => tx.select({ n: sql<number>`count(*)` }).from(occurrences).innerJoin(schedules, eq(schedules.id, occurrences.scheduleId));
        const localToday = sql`vmn_local_date(${input.now.getTime()}, ${schedules.timeZone})`;
        const completedOccurrencesToday = schedulesOn ? occurrenceQuery().where(and(occurrenceWhere, eq(occurrences.state, 'COMPLETED'), gte(occurrences.closedAt, new Date(input.now.getTime() - 48 * 60 * 60_000)), sql`vmn_local_date(${occurrences.closedAt}, ${schedules.timeZone}) = ${localToday}`)).get()?.n ?? 0 : null;
        const dueToday = schedulesOn ? occurrenceQuery().where(and(occurrenceWhere, sql`${occurrences.state} in ('OPEN', 'IN_PROGRESS')`, sql`${occurrences.dueDate} = ${localToday}`)).get()?.n ?? 0 : null;
        // An unlinked Run has no assignee and belongs to Shared. Current linked Runs inherit the Occurrence scope.
        const runScope = input.filter === 'ALL' ? sql`1` : input.filter === 'MINE' ? sql`exists (select 1 from ${occurrenceRuns} join ${occurrences} on ${occurrences.id} = ${occurrenceRuns.occurrenceId} join ${schedules} on ${schedules.id} = ${occurrences.scheduleId} where ${occurrenceRuns.runId} = ${runs.id} and ${occurrenceRuns.endedAt} is null and ${responsible} = ${input.userId})` : sql`not exists (select 1 from ${occurrenceRuns} join ${occurrences} on ${occurrences.id} = ${occurrenceRuns.occurrenceId} join ${schedules} on ${schedules.id} = ${occurrences.scheduleId} where ${occurrenceRuns.runId} = ${runs.id} and ${occurrenceRuns.endedAt} is null and ${responsible} is not null)`;
        const runWhere = and(eq(runs.workspaceId, input.workspaceId), runScope);
        const runCount = (where: SQL | undefined) => tx.select({ n: sql<number>`count(*)` }).from(runs).where(where).get()?.n ?? 0;
        const completedRunsThisWeek = proceduresOn ? runCount(and(runWhere, eq(runs.state, 'COMPLETED'), gte(runs.endedAt, from), lt(runs.endedAt, until))) : null;
        const activeRuns = proceduresOn ? runCount(and(runWhere, eq(runs.state, 'ACTIVE'))) : null;
        const occurrenceActivity = schedulesOn ? tx.select({ id: occurrences.id, scheduleId: schedules.id, title: sql<string>`coalesce(${schedules.title}, ${procedures.title}, '')`, at: occurrences.closedAt }).from(occurrences).innerJoin(schedules, eq(schedules.id, occurrences.scheduleId)).leftJoin(procedures, eq(procedures.id, schedules.procedureId)).where(and(occurrenceWhere, eq(occurrences.state, 'COMPLETED'))).orderBy(desc(occurrences.closedAt), desc(occurrences.id)).limit(10).all() : [];
        const runActivity = proceduresOn ? tx.select({ id: runs.id, title: runs.title, at: runs.endedAt }).from(runs).where(and(runWhere, eq(runs.state, 'COMPLETED'), sql`not exists (select 1 from ${occurrenceRuns} join ${occurrences} on ${occurrences.id} = ${occurrenceRuns.occurrenceId} where ${occurrenceRuns.runId} = ${runs.id} and ${occurrenceRuns.endedAt} is null and ${occurrences.state} = 'COMPLETED')`)).orderBy(desc(runs.endedAt), desc(runs.id)).limit(10).all() : [];
        const recentlyCompleted = [
          ...occurrenceActivity.flatMap((row) => row.at === null ? [] : [{ type: 'occurrence' as const, id: row.id, scheduleId: row.scheduleId, title: row.title, completedAt: row.at }]),
          ...runActivity.flatMap((row) => row.at === null ? [] : [{ type: 'run' as const, id: row.id, scheduleId: null, title: row.title, completedAt: row.at }]),
        ].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || b.id.localeCompare(a.id)).slice(0, 10);
        return { filter: input.filter, weekFrom: weekFrom as LocalDate, weekTo, completedOccurrencesToday, completedRunsThisWeek, activeRuns, dueToday, recentlyCompleted };
      });
    },
  };
}
