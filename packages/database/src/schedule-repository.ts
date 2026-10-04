import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, max, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type {
  OccurrenceHistoryEntry,
  OccurrenceWriteResult,
  ScheduleContentInput,
  ScheduleRepository,
  ScheduleWriteResult,
  ScheduleWriteStatus,
  ScheduledOccurrence,
} from '@vergissmeinnicht/application';
import {
  DEFAULT_REMINDER_TIME,
  STEP_STATES,
  addDays,
  dueAfterCompletion,
  firstDueDate,
  localDateAt,
  nextFixedDate,
  reminderRecipientId,
  upcomingReminders,
  zonedInstant,
  type LocalDate,
  type LocalTime,
  type Occurrence,
  type OccurrenceId,
  type ProcedureIcon,
  type ProcedureId,
  type Recurrence,
  type RunId,
  type RunSummary,
  type Schedule,
  type ScheduleId,
  type StepState,
  type TimeZoneName,
  type UserId,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { enabledScheduleSource, toolEnabled } from './tool-policy.ts';
import { toRun } from './run-repository.ts';
import {
  memberships,
  notificationPreferences,
  occurrenceRuns,
  occurrences,
  procedures,
  runSteps,
  runs,
  scheduledReminders,
  schedules,
  users,
} from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type ScheduleRow = typeof schedules.$inferSelect;
type OccurrenceRow = typeof occurrences.$inferSelect;

const scheduleAssignee = alias(users, 'schedule_assignee');
const occurrenceAssignee = alias(users, 'occurrence_assignee');

/** Generator bound per series and run: a long outage creates the elapsed Occurrences over a few minutes, never a burst. */
const MAX_CREATED_PER_SERIES = 24;

function recurrenceOf(row: ScheduleRow): Recurrence {
  if (row.recurrenceKind === 'ONCE' || row.recurrenceUnit === null || row.recurrenceInterval === null) return { kind: 'ONCE' };
  if (row.recurrenceKind === 'AFTER_COMPLETION') return { kind: 'AFTER_COMPLETION', unit: row.recurrenceUnit, interval: row.recurrenceInterval };
  return { kind: 'FIXED', unit: row.recurrenceUnit, interval: row.recurrenceInterval, weekdays: row.recurrenceWeekdays, lastDayOfMonth: row.recurrenceLastDay };
}

function recurrenceColumns(recurrence: Recurrence) {
  return {
    recurrenceKind: recurrence.kind,
    recurrenceUnit: recurrence.kind === 'ONCE' ? null : recurrence.unit,
    recurrenceInterval: recurrence.kind === 'ONCE' ? null : recurrence.interval,
    recurrenceWeekdays: recurrence.kind === 'FIXED' && recurrence.weekdays !== null ? [...recurrence.weekdays] : null,
    recurrenceLastDay: recurrence.kind === 'FIXED' && recurrence.lastDayOfMonth,
  };
}

type ScheduleJoin = {
  schedule: ScheduleRow;
  procedure: { title: string; icon: string; deletedAt: Date | null } | null;
  assignee: { id: string; name: string } | null;
};

function toSchedule({ schedule, procedure, assignee }: ScheduleJoin): Schedule {
  return {
    id: schedule.id as ScheduleId,
    workspaceId: schedule.workspaceId as WorkspaceId,
    kind: schedule.kind,
    procedureId: schedule.procedureId as ProcedureId | null,
    procedure: procedure === null ? null : { title: procedure.title, icon: procedure.icon as ProcedureIcon, deleted: procedure.deletedAt !== null },
    title: schedule.title ?? procedure?.title ?? '',
    description: schedule.description,
    recurrence: recurrenceOf(schedule),
    anchorDate: schedule.anchorDate as LocalDate,
    time: schedule.time as LocalTime | null,
    timeZone: schedule.timeZone as TimeZoneName,
    reminders: schedule.reminders,
    assignee: assignee === null ? null : { userId: assignee.id as UserId, displayName: assignee.name },
    state: schedule.state,
    pausedAt: schedule.pausedAt,
    ended:
      schedule.endedAt === null || schedule.endedByUserId === null || schedule.endedByDisplayName === null
        ? null
        : { at: schedule.endedAt, by: { userId: schedule.endedByUserId as UserId, displayName: schedule.endedByDisplayName } },
    revision: schedule.revision,
    createdAt: schedule.createdAt,
    createdBy: { userId: schedule.createdByUserId as UserId, displayName: schedule.createdByDisplayName },
  };
}

function selectSchedules(tx: Reader) {
  return tx
    .select({
      schedule: schedules,
      procedure: { title: procedures.title, icon: procedures.icon, deletedAt: procedures.deletedAt },
      assignee: { id: scheduleAssignee.id, name: scheduleAssignee.name },
    })
    .from(schedules)
    .leftJoin(procedures, eq(procedures.id, schedules.procedureId))
    .leftJoin(scheduleAssignee, eq(scheduleAssignee.id, schedules.assigneeUserId));
}

function selectOccurrences(tx: Reader) {
  return tx
    .select({
      occurrence: occurrences,
      schedule: schedules,
      procedure: { title: procedures.title, icon: procedures.icon, deletedAt: procedures.deletedAt },
      assignee: { id: scheduleAssignee.id, name: scheduleAssignee.name },
      occurrenceAssignee: { id: occurrenceAssignee.id, name: occurrenceAssignee.name },
      run: { id: runs.id, state: runs.state, startedAt: runs.startedAt, startedBy: runs.startedByDisplayName },
    })
    .from(occurrences)
    .innerJoin(schedules, eq(schedules.id, occurrences.scheduleId))
    .leftJoin(procedures, eq(procedures.id, schedules.procedureId))
    .leftJoin(scheduleAssignee, eq(scheduleAssignee.id, schedules.assigneeUserId))
    .leftJoin(occurrenceAssignee, eq(occurrenceAssignee.id, occurrences.assigneeUserId))
    .leftJoin(occurrenceRuns, and(eq(occurrenceRuns.occurrenceId, occurrences.id), isNull(occurrenceRuns.endedAt)))
    .leftJoin(runs, eq(runs.id, occurrenceRuns.runId));
}

type OccurrenceJoin = ScheduleJoin & {
  occurrence: OccurrenceRow;
  occurrenceAssignee: { id: string; name: string } | null;
  run: { id: string; state: 'ACTIVE' | 'COMPLETED' | 'ABORTED'; startedAt: Date; startedBy: string } | null;
};

function toOccurrence(row: OccurrenceJoin): ScheduledOccurrence {
  const o = row.occurrence;
  const occurrence: Occurrence = {
    id: o.id as OccurrenceId,
    scheduleId: o.scheduleId as ScheduleId,
    workspaceId: o.workspaceId as WorkspaceId,
    dueDate: o.dueDate as LocalDate,
    time: o.time as LocalTime | null,
    state: o.state,
    assignee: row.occurrenceAssignee === null ? null : { userId: row.occurrenceAssignee.id as UserId, displayName: row.occurrenceAssignee.name },
    closed:
      o.closedAt === null || o.closedByUserId === null || o.closedByDisplayName === null
        ? null
        : { at: o.closedAt, by: { userId: o.closedByUserId as UserId, displayName: o.closedByDisplayName } },
    skipReason: o.skipReason,
    run: row.run === null ? null : { id: row.run.id as RunId, state: row.run.state, startedAt: row.run.startedAt, startedBy: row.run.startedBy },
    revision: o.revision,
    createdAt: o.createdAt,
  };
  return { schedule: toSchedule(row), occurrence };
}

function findScheduleIn(tx: Reader, workspaceId: string, scheduleId: string): Schedule | undefined {
  const row = selectSchedules(tx)
    .where(and(enabledScheduleSource, eq(schedules.workspaceId, workspaceId), eq(schedules.id, scheduleId)))
    .get();
  return row === undefined ? undefined : toSchedule(row);
}

function findOccurrenceIn(tx: Reader, workspaceId: string, occurrenceId: string): ScheduledOccurrence | undefined {
  const row = selectOccurrences(tx)
    .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), eq(occurrences.id, occurrenceId)))
    .get();
  return row === undefined ? undefined : toOccurrence(row);
}

const todayOf = (schedule: Pick<ScheduleRow, 'timeZone'>, at: Date) => localDateAt(at, schedule.timeZone as TimeZoneName);

// ---- Reminders per Occurrence and recipient

/** Cancels the unsent reminders of an Occurrence (rows stay; deliveries may reference them). */
function cancelReminders(tx: Transaction, occurrenceId: string, at: Date): void {
  tx.update(scheduledReminders)
    .set({ cancelledAt: at })
    .where(and(eq(scheduledReminders.occurrenceId, occurrenceId), isNull(scheduledReminders.processedAt), isNull(scheduledReminders.cancelledAt)))
    .run();
}

/**
 * Recomputes an Occurrence's reminders: unsent ones are cancelled, and — while it is OPEN and its
 * Schedule ACTIVE — the instants still ahead are stored for the current recipient (Assignee, else
 * creator) at that person's reminder time. A processed instant stays processed: never sent twice.
 */
function refreshReminders(tx: Transaction, occurrence: OccurrenceRow, schedule: ScheduleRow, now: Date): void {
  cancelReminders(tx, occurrence.id, now);
  if (occurrence.state !== 'OPEN' || schedule.state !== 'ACTIVE') return;
  const recipient = reminderRecipientId(schedule, occurrence);
  const reminderTime = (tx.select({ time: notificationPreferences.reminderTime }).from(notificationPreferences).where(eq(notificationPreferences.userId, recipient)).get()?.time ??
    DEFAULT_REMINDER_TIME) as LocalTime;
  const upcoming = upcomingReminders(
    { dueDate: occurrence.dueDate as LocalDate, time: occurrence.time as LocalTime | null, timeZone: schedule.timeZone as TimeZoneName },
    schedule.reminders,
    reminderTime,
    now,
  );
  for (const reminder of upcoming) {
    tx.insert(scheduledReminders)
      .values({ id: randomUUID(), occurrenceId: occurrence.id, reminderKey: reminder.key, remindAt: reminder.at, recipientUserId: recipient })
      .onConflictDoUpdate({
        target: [scheduledReminders.occurrenceId, scheduledReminders.recipientUserId, scheduledReminders.reminderKey, scheduledReminders.remindAt],
        set: { cancelledAt: null },
        setWhere: isNull(scheduledReminders.processedAt),
      })
      .run();
  }
}

function occurrenceRows(tx: Reader, scheduleId: string, states: readonly OccurrenceRow['state'][]) {
  return tx
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.scheduleId, scheduleId), inArray(occurrences.state, [...states])))
    .orderBy(asc(occurrences.dueDate))
    .all();
}

function refreshScheduleReminders(tx: Transaction, schedule: ScheduleRow, now: Date): void {
  for (const occurrence of occurrenceRows(tx, schedule.id, ['OPEN'])) refreshReminders(tx, occurrence, schedule, now);
}

// ---- Occurrence creation

/** Creates an Occurrence unless one is already due on that date (idempotent). */
function createOccurrence(tx: Transaction, schedule: ScheduleRow, dueDate: LocalDate, at: Date): OccurrenceRow | undefined {
  const row = tx
    .insert(occurrences)
    .values({ id: randomUUID(), scheduleId: schedule.id, workspaceId: schedule.workspaceId, dueDate, time: schedule.time, state: 'OPEN', createdAt: at, updatedAt: at })
    .onConflictDoNothing()
    .returning()
    .get();
  if (row !== undefined) refreshReminders(tx, row, schedule, at);
  return row;
}

function latestDueDate(tx: Reader, scheduleId: string): LocalDate | undefined {
  return tx
    .select({ due: occurrences.dueDate })
    .from(occurrences)
    .where(and(eq(occurrences.scheduleId, scheduleId), ne(occurrences.state, 'CANCELLED')))
    .orderBy(desc(occurrences.dueDate))
    .limit(1)
    .get()?.due as LocalDate | undefined;
}

/**
 * Fixed series: creates Occurrences after the latest one until one is due today or later — one per
 * elapsed period, so an ignored series grows incrementally, never in bursts. With `after` (an edit),
 * the series continues after that date and at least the next Occurrence is created.
 */
function ensureFixedOccurrences(tx: Transaction, schedule: ScheduleRow, at: Date, after?: LocalDate): OccurrenceRow[] {
  const recurrence = recurrenceOf(schedule);
  if (recurrence.kind !== 'FIXED' || schedule.state !== 'ACTIVE') return [];
  const today = todayOf(schedule, at);
  const created: OccurrenceRow[] = [];
  let latest = after ?? latestDueDate(tx, schedule.id);
  if (after === undefined && latest !== undefined && latest >= today) return created;
  for (let i = 0; i < MAX_CREATED_PER_SERIES; i++) {
    const next = latest === undefined ? firstDueDate(recurrence, schedule.anchorDate as LocalDate) : nextFixedDate(recurrence, schedule.anchorDate as LocalDate, latest);
    const row = createOccurrence(tx, schedule, next, at);
    if (row !== undefined) created.push(row);
    latest = next;
    if (next >= today) break;
  }
  return created;
}

/** Completion-based series: the next Occurrence after a completion or skip (not while paused or ended). */
function createNextAfterCompletion(tx: Transaction, schedule: ScheduleRow, closedAt: Date, at: Date): void {
  const recurrence = recurrenceOf(schedule);
  if (recurrence.kind !== 'AFTER_COMPLETION' || schedule.state !== 'ACTIVE') return;
  createOccurrence(tx, schedule, dueAfterCompletion(recurrence, localDateAt(closedAt, schedule.timeZone as TimeZoneName)), at);
}

/**
 * Before a completion-based Occurrence is reopened or its Run unlinked: the Occurrence created from its
 * completion is withdrawn if nobody acted on it yet; otherwise the change is refused.
 */
function withdrawNextAfter(tx: Transaction, schedule: ScheduleRow, occurrence: OccurrenceRow, actor: UserActor, at: Date): boolean {
  if (schedule.recurrenceKind !== 'AFTER_COMPLETION') return true;
  const later = tx
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.scheduleId, schedule.id), ne(occurrences.state, 'CANCELLED'), sql`${occurrences.createdAt} >= ${occurrence.updatedAt.getTime()}`, ne(occurrences.id, occurrence.id)))
    .all();
  if (later.some((row) => row.state !== 'OPEN' || hasCurrentRun(tx, row.id))) return false;
  for (const row of later) closeOccurrence(tx, row, 'CANCELLED', actor, at, null);
  return true;
}

function hasCurrentRun(tx: Reader, occurrenceId: string): boolean {
  return tx.select({ id: occurrenceRuns.id }).from(occurrenceRuns).where(and(eq(occurrenceRuns.occurrenceId, occurrenceId), isNull(occurrenceRuns.endedAt))).get() !== undefined;
}

function closeOccurrence(tx: Transaction, occurrence: OccurrenceRow, state: 'COMPLETED' | 'SKIPPED' | 'CANCELLED', by: { userId: string; displayName: string }, at: Date, reason: string | null): void {
  tx.update(occurrences)
    .set({ state, closedAt: at, closedByUserId: by.userId, closedByDisplayName: by.displayName, skipReason: state === 'SKIPPED' ? reason : null, revision: occurrence.revision + 1, updatedAt: at })
    .where(eq(occurrences.id, occurrence.id))
    .run();
  cancelReminders(tx, occurrence.id, at);
}

// ---- Validation inside the transaction

/** An Assignee must be an ACTIVE member of the Workspace who can see its Procedures. */
function assigneeAllowed(tx: Reader, workspaceId: string, userId: string | null): boolean {
  if (userId === null) return true;
  const row = tx
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), eq(users.status, 'ACTIVE')))
    .get();
  return row !== undefined && roleHasCapability(row.role, 'procedure.view');
}

/** Active or paused Schedules that still matter: recurring ones, and one-time ones with an open Occurrence. */
function openScheduleCount(tx: Reader, workspaceId: string): number {
  return (
    tx
      .select({ n: sql<number>`count(*)` })
      .from(schedules)
      .where(
        and(
          eq(schedules.workspaceId, workspaceId),
          inArray(schedules.state, ['ACTIVE', 'PAUSED']),
          or(
            ne(schedules.recurrenceKind, 'ONCE'),
            sql`exists (select 1 from ${occurrences} where ${occurrences.scheduleId} = ${schedules.id} and ${occurrences.state} in ('OPEN', 'IN_PROGRESS'))`,
          ),
        ),
      )
      .get()?.n ?? 0
  );
}

function scheduleRowIn(tx: Reader, workspaceId: string, scheduleId: string): ScheduleRow | undefined {
  return tx
    .select()
    .from(schedules)
    .where(and(enabledScheduleSource, eq(schedules.workspaceId, workspaceId), eq(schedules.id, scheduleId)))
    .get();
}

function occurrenceRowIn(tx: Reader, workspaceId: string, occurrenceId: string): { occurrence: OccurrenceRow; schedule: ScheduleRow } | undefined {
  const row = tx
    .select({ occurrence: occurrences, schedule: schedules })
    .from(occurrences)
    .innerJoin(schedules, eq(schedules.id, occurrences.scheduleId))
    .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), eq(occurrences.id, occurrenceId)))
    .get();
  return row;
}

type Audit = Parameters<typeof recordAuditEvent>[1];
const scheduleAudit = (schedule: ScheduleRow, type: Audit['type'], actor: UserActor, at: Date, metadata: Audit['metadata'] = {}): Audit => ({
  workspaceId: schedule.workspaceId as WorkspaceId,
  type,
  actor,
  subjectType: 'schedule',
  subjectId: schedule.id,
  occurredAt: at,
  metadata: { kind: schedule.kind, ...metadata },
});
const occurrenceAudit = (occurrence: OccurrenceRow, type: Audit['type'], actor: UserActor, at: Date, metadata: Audit['metadata'] = {}, runId?: string): Audit => ({
  workspaceId: occurrence.workspaceId as WorkspaceId,
  type,
  actor,
  subjectType: 'occurrence',
  subjectId: occurrence.id,
  occurredAt: at,
  ...(runId === undefined ? {} : { runId }),
  metadata: { scheduleId: occurrence.scheduleId, dueDate: occurrence.dueDate, ...metadata },
});

// ---- Hooks used by the Run repository inside its transactions (Start, Complete, Abort)

/** Start from an Occurrence: it must be OPEN, of a PROCEDURE Schedule for this Procedure, in this Workspace. */
export function occurrenceIsStartable(tx: Reader, workspaceId: string, occurrenceId: string, procedureId: string): boolean {
  const row = occurrenceRowIn(tx, workspaceId, occurrenceId);
  return row !== undefined && row.occurrence.state === 'OPEN' && row.schedule.kind === 'PROCEDURE' && row.schedule.procedureId === procedureId && row.schedule.state !== 'ENDED';
}

/** After `occurrenceIsStartable`, in the same transaction: links the new Run → IN_PROGRESS. */
export function linkStartedRun(tx: Transaction, input: { workspaceId: string; occurrenceId: string; runId: string; at: Date; actor: UserActor }): void {
  const row = occurrenceRowIn(tx, input.workspaceId, input.occurrenceId);
  if (row === undefined) throw new Error('occurrence vanished inside the transaction');
  tx.insert(occurrenceRuns)
    .values({
      id: randomUUID(),
      occurrenceId: row.occurrence.id,
      runId: input.runId,
      workspaceId: input.workspaceId,
      how: 'STARTED',
      linkedAt: input.at,
      linkedByUserId: input.actor.userId,
      linkedByDisplayName: input.actor.displayName,
    })
    .run();
  tx.update(occurrences)
    .set({ state: 'IN_PROGRESS', revision: row.occurrence.revision + 1, updatedAt: input.at })
    .where(eq(occurrences.id, row.occurrence.id))
    .run();
  cancelReminders(tx, row.occurrence.id, input.at);
}

/**
 * A Run ended (same transaction): a completed Run completes the Occurrence it is linked to; an
 * aborted Run is kept in the Occurrence's history and the Occurrence is OPEN again. Runs not linked
 * to an Occurrence change nothing here.
 */
export function onRunFinished(tx: Transaction, input: { runId: string; to: 'COMPLETED' | 'ABORTED'; at: Date; actor: UserActor }): void {
  const link = tx.select().from(occurrenceRuns).where(and(eq(occurrenceRuns.runId, input.runId), isNull(occurrenceRuns.endedAt))).get();
  if (link === undefined) return;
  const row = occurrenceRowIn(tx, link.workspaceId, link.occurrenceId);
  if (row === undefined) return;
  if (input.to === 'COMPLETED') {
    if (row.occurrence.state !== 'IN_PROGRESS') return;
    closeOccurrence(tx, row.occurrence, 'COMPLETED', input.actor, input.at, null);
    recordAuditEvent(tx, occurrenceAudit(row.occurrence, 'OCCURRENCE_COMPLETED', input.actor, input.at, { via: 'run' }, input.runId));
    createNextAfterCompletion(tx, row.schedule, input.at, input.at);
    return;
  }
  tx.update(occurrenceRuns).set({ endedAt: input.at, endReason: 'ABORTED' }).where(eq(occurrenceRuns.id, link.id)).run();
  if (row.occurrence.state === 'IN_PROGRESS') {
    const reopened = { ...row.occurrence, state: 'OPEN' as const, revision: row.occurrence.revision + 1, updatedAt: input.at };
    tx.update(occurrences).set({ state: 'OPEN', revision: reopened.revision, updatedAt: input.at }).where(eq(occurrences.id, row.occurrence.id)).run();
    refreshReminders(tx, reopened, row.schedule, input.at);
  }
}

// ---- Repository

export function createScheduleRepository({ db }: Pick<AppDatabase, 'db'>): ScheduleRepository {
  const scheduleWrite = (
    input: { workspaceId: WorkspaceId; scheduleId: ScheduleId; expectedRevision?: number },
    actor: UserActor,
    guard: Parameters<ScheduleRepository['pause']>[2],
    change: (tx: Transaction, schedule: ScheduleRow) => ScheduleWriteStatus | 'ok',
  ): Promise<ScheduleWriteResult> =>
    Promise.resolve(
      db.transaction((tx): ScheduleWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const schedule = scheduleRowIn(tx, input.workspaceId, input.scheduleId);
        if (schedule === undefined) return { status: 'not_found' };
        if (schedule.state === 'ENDED') return { status: 'closed' };
        if (input.expectedRevision !== undefined && schedule.revision !== input.expectedRevision) return { status: 'conflict' };
        const status = change(tx, schedule);
        if (status !== 'ok') return { status };
        return { status: 'ok', schedule: findScheduleIn(tx, input.workspaceId, schedule.id) as Schedule };
      }, IMMEDIATE),
    );

  const occurrenceWrite = (
    input: { workspaceId: WorkspaceId; occurrenceId: OccurrenceId },
    actor: UserActor,
    guard: Parameters<ScheduleRepository['pause']>[2],
    change: (tx: Transaction, occurrence: OccurrenceRow, schedule: ScheduleRow) => ScheduleWriteStatus | 'ok',
  ): Promise<OccurrenceWriteResult> =>
    Promise.resolve(
      db.transaction((tx): OccurrenceWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const row = occurrenceRowIn(tx, input.workspaceId, input.occurrenceId);
        if (row === undefined) return { status: 'not_found' };
        const status = change(tx, row.occurrence, row.schedule);
        if (status !== 'ok') return { status };
        return { status: 'ok', item: findOccurrenceIn(tx, input.workspaceId, row.occurrence.id) as ScheduledOccurrence };
      }, IMMEDIATE),
    );

  const contentColumns = (input: ScheduleContentInput) => ({
    title: input.title,
    description: input.description,
    ...recurrenceColumns(input.recurrence),
    anchorDate: input.anchorDate,
    time: input.time,
    timeZone: input.timeZone,
    reminders: input.reminders.map((reminder) => ({ ...reminder })),
    assigneeUserId: input.assigneeUserId,
  });

  return {
    async create(input, actor, guard) {
      return db.transaction((tx): ScheduleWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        if (!toolEnabled(tx, input.workspaceId, input.kind === 'PROCEDURE' ? 'PROCEDURES' : 'REMINDERS')) return { status: 'not_found' };
        if (input.kind === 'PROCEDURE') {
          const procedure =
            input.procedureId === null
              ? undefined
              : tx
                  .select({ id: procedures.id })
                  .from(procedures)
                  .where(and(eq(procedures.workspaceId, input.workspaceId), eq(procedures.id, input.procedureId), isNull(procedures.deletedAt)))
                  .get();
          if (procedure === undefined) return { status: 'procedure_not_found' };
        }
        if (!assigneeAllowed(tx, input.workspaceId, input.assigneeUserId)) return { status: 'invalid_assignee' };
        if (openScheduleCount(tx, input.workspaceId) >= input.maxOpen) return { status: 'limit_reached' };
        const schedule = tx
          .insert(schedules)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            kind: input.kind,
            procedureId: input.kind === 'PROCEDURE' ? input.procedureId : null,
            ...contentColumns(input),
            title: input.kind === 'REMINDER' ? input.title : null,
            description: input.kind === 'REMINDER' ? input.description : '',
            state: 'ACTIVE',
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .returning()
          .get();
        if (input.recurrence.kind === 'FIXED') ensureFixedOccurrences(tx, schedule, input.at);
        else createOccurrence(tx, schedule, firstDueDate(input.recurrence, input.anchorDate), input.at);
        recordAuditEvent(
          tx,
          scheduleAudit(schedule, 'SCHEDULE_CREATED', actor, input.at, {
            ...(schedule.procedureId === null ? {} : { procedureId: schedule.procedureId }),
            recurrence: input.recurrence.kind,
            date: input.anchorDate,
            reminders: input.reminders.length,
            assigned: input.assigneeUserId !== null,
          }),
        );
        return { status: 'ok', schedule: findScheduleIn(tx, input.workspaceId, schedule.id) as Schedule };
      }, IMMEDIATE);
    },

    update(input, actor, guard) {
      return scheduleWrite(input, actor, guard, (tx, current) => {
        if (!assigneeAllowed(tx, input.workspaceId, input.assigneeUserId) && input.assigneeUserId !== current.assigneeUserId) return 'invalid_assignee';
        const next = contentColumns(input);
        const timingChanged =
          JSON.stringify(recurrenceColumns(recurrenceOf(current))) !== JSON.stringify(recurrenceColumns(input.recurrence)) ||
          current.anchorDate !== input.anchorDate ||
          current.time !== input.time ||
          current.timeZone !== input.timeZone;
        if (timingChanged && recurrenceOf(current).kind !== input.recurrence.kind && (recurrenceOf(current).kind === 'ONCE') !== (input.recurrence.kind === 'ONCE')) {
          // A one-time item and a series are different things; changing between them is a new Schedule.
          return 'wrong_kind';
        }
        const today = todayOf({ timeZone: input.timeZone }, input.at);
        const movable = occurrenceRows(tx, current.id, ['OPEN']).filter((row) => !hasCurrentRun(tx, row.id));
        // Checked before writing anything: a non-ok result must leave the transaction without changes.
        if (timingChanged && input.recurrence.kind === 'ONCE' && movable[0] === undefined) return 'closed';
        const updated = tx
          .update(schedules)
          .set({
            ...next,
            title: current.kind === 'REMINDER' ? input.title : null,
            description: current.kind === 'REMINDER' ? input.description : '',
            revision: current.revision + 1,
            updatedAt: input.at,
          })
          .where(and(eq(schedules.id, current.id), eq(schedules.revision, current.revision)))
          .returning()
          .get();
        if (updated === undefined) return 'conflict';
        if (timingChanged) {
          const open = movable;
          if (input.recurrence.kind === 'ONCE') {
            const only = open[0];
            if (only === undefined) return 'closed';
            const moved = { ...only, dueDate: input.anchorDate, time: input.time, revision: only.revision + 1, updatedAt: input.at };
            tx.update(occurrences).set({ dueDate: moved.dueDate, time: moved.time, revision: moved.revision, updatedAt: input.at }).where(eq(occurrences.id, only.id)).run();
            refreshReminders(tx, moved, updated, input.at);
          } else {
            // Occurrences due today or later that nobody acted on follow the new rule; overdue ones stay.
            for (const row of open) if (row.dueDate >= today) closeOccurrence(tx, row, 'CANCELLED', actor, input.at, null);
            if (input.recurrence.kind === 'FIXED') {
              const latest = latestDueDate(tx, current.id);
              const after = addDays(input.anchorDate, -1) > addDays(today, -1) ? addDays(input.anchorDate, -1) : addDays(today, -1);
              ensureFixedOccurrences(tx, updated, input.at, latest !== undefined && latest > after ? latest : after);
            } else if (occurrenceRows(tx, current.id, ['OPEN', 'IN_PROGRESS']).length === 0) {
              createOccurrence(tx, updated, input.anchorDate < today ? today : input.anchorDate, input.at);
            }
          }
        }
        refreshScheduleReminders(tx, updated, input.at);
        recordAuditEvent(tx, scheduleAudit(updated, 'SCHEDULE_CHANGED', actor, input.at, { recurrence: input.recurrence.kind, date: input.anchorDate, reminders: input.reminders.length }));
        if (current.assigneeUserId !== input.assigneeUserId) {
          recordAuditEvent(tx, scheduleAudit(updated, 'SCHEDULE_ASSIGNED', actor, input.at, { assigned: input.assigneeUserId !== null }));
        }
        return 'ok';
      });
    },

    pause(input, actor, guard) {
      return scheduleWrite(input, actor, guard, (tx, current) => {
        if (current.state === 'PAUSED') return 'ok';
        const paused = tx.update(schedules).set({ state: 'PAUSED', pausedAt: input.at, revision: current.revision + 1, updatedAt: input.at }).where(eq(schedules.id, current.id)).returning().get();
        if (paused === undefined) return 'conflict';
        for (const row of occurrenceRows(tx, current.id, ['OPEN'])) cancelReminders(tx, row.id, input.at);
        recordAuditEvent(tx, scheduleAudit(paused, 'SCHEDULE_PAUSED', actor, input.at));
        return 'ok';
      });
    },

    resume(input, actor, guard) {
      return scheduleWrite(input, actor, guard, (tx, current) => {
        if (current.state !== 'PAUSED') return 'ok';
        const resumed = tx.update(schedules).set({ state: 'ACTIVE', pausedAt: null, revision: current.revision + 1, updatedAt: input.at }).where(eq(schedules.id, current.id)).returning().get();
        if (resumed === undefined) return 'conflict';
        const today = todayOf(resumed, input.at);
        let skipped = 0;
        if (resumed.recurrenceKind === 'FIXED') {
          // The original anchor stays; Occurrences that fell into the pause are created and — when chosen — skipped.
          for (const row of ensureFixedOccurrences(tx, resumed, input.at)) {
            if (input.skipElapsed && row.dueDate < today) {
              closeOccurrence(tx, row, 'SKIPPED', actor, input.at, null);
              recordAuditEvent(tx, occurrenceAudit(row, 'OCCURRENCE_SKIPPED', actor, input.at, { reason: 'paused' }));
              skipped++;
            }
          }
        } else if (resumed.recurrenceKind === 'AFTER_COMPLETION' && occurrenceRows(tx, current.id, ['OPEN', 'IN_PROGRESS']).length === 0) {
          // Completed while paused: the next one counts from that completion.
          const last = tx
            .select()
            .from(occurrences)
            .where(and(eq(occurrences.scheduleId, current.id), inArray(occurrences.state, ['COMPLETED', 'SKIPPED'])))
            .orderBy(desc(occurrences.closedAt))
            .limit(1)
            .get();
          if (last?.closedAt) createNextAfterCompletion(tx, resumed, last.closedAt, input.at);
        }
        // A completion-based series keeps its existing due date, even if that is overdue now.
        refreshScheduleReminders(tx, resumed, input.at);
        recordAuditEvent(tx, scheduleAudit(resumed, 'SCHEDULE_RESUMED', actor, input.at, { skipped }));
        return 'ok';
      });
    },

    end(input, actor, guard) {
      return scheduleWrite(input, actor, guard, (tx, current) => {
        for (const row of occurrenceRows(tx, current.id, ['OPEN'])) closeOccurrence(tx, row, 'CANCELLED', actor, input.at, null);
        const ended = tx
          .update(schedules)
          .set({ state: 'ENDED', pausedAt: null, endedAt: input.at, endedByUserId: actor.userId, endedByDisplayName: actor.displayName, revision: current.revision + 1, updatedAt: input.at })
          .where(eq(schedules.id, current.id))
          .returning()
          .get();
        if (ended === undefined) return 'conflict';
        recordAuditEvent(tx, scheduleAudit(ended, 'SCHEDULE_ENDED', actor, input.at));
        return 'ok';
      });
    },

    async skipOlder(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' as const };
        const schedule = scheduleRowIn(tx, input.workspaceId, input.scheduleId);
        if (schedule === undefined) return { status: 'not_found' as const };
        if (schedule.recurrenceKind === 'AFTER_COMPLETION') return { status: 'wrong_kind' as const };
        const older = occurrenceRows(tx, schedule.id, ['OPEN']).filter((row) => row.dueDate < input.before && !hasCurrentRun(tx, row.id));
        for (const row of older) {
          closeOccurrence(tx, row, 'SKIPPED', actor, input.at, input.reason);
          recordAuditEvent(tx, occurrenceAudit(row, 'OCCURRENCE_SKIPPED', actor, input.at, { bulk: true, ...(input.reason === null ? {} : { reason: input.reason }) }));
        }
        return { status: 'ok' as const, skipped: older.length };
      }, IMMEDIATE);
    },

    complete(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (schedule.kind !== 'REMINDER') return 'wrong_kind';
        if (occurrence.state !== 'OPEN') return 'closed';
        closeOccurrence(tx, occurrence, 'COMPLETED', actor, input.at, null);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_COMPLETED', actor, input.at));
        createNextAfterCompletion(tx, schedule, input.at, input.at);
        return 'ok';
      });
    },

    reopen(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (occurrence.state === 'COMPLETED' && schedule.kind !== 'REMINDER') return 'wrong_kind';
        if (occurrence.state !== 'COMPLETED' && occurrence.state !== 'SKIPPED') return 'closed';
        if (schedule.state === 'ENDED') return 'closed';
        if (!withdrawNextAfter(tx, schedule, occurrence, actor, input.at)) return 'next_in_use';
        const reopened = { ...occurrence, state: 'OPEN' as const, closedAt: null, closedByUserId: null, closedByDisplayName: null, skipReason: null, revision: occurrence.revision + 1, updatedAt: input.at };
        tx.update(occurrences)
          .set({ state: 'OPEN', closedAt: null, closedByUserId: null, closedByDisplayName: null, skipReason: null, revision: reopened.revision, updatedAt: input.at })
          .where(eq(occurrences.id, occurrence.id))
          .run();
        refreshReminders(tx, reopened, schedule, input.at);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_REOPENED', actor, input.at, { from: occurrence.state }));
        return 'ok';
      });
    },

    skip(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (occurrence.state !== 'OPEN') return 'closed';
        closeOccurrence(tx, occurrence, 'SKIPPED', actor, input.at, input.reason);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_SKIPPED', actor, input.at, input.reason === null ? {} : { reason: input.reason }));
        createNextAfterCompletion(tx, schedule, input.at, input.at);
        return 'ok';
      });
    },

    move(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (occurrence.state !== 'OPEN') return 'closed';
        const taken = tx
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(and(eq(occurrences.scheduleId, schedule.id), eq(occurrences.dueDate, input.dueDate), ne(occurrences.state, 'CANCELLED'), ne(occurrences.id, occurrence.id)))
          .get();
        if (taken !== undefined) return 'date_taken';
        const moved = { ...occurrence, dueDate: input.dueDate, time: input.time, revision: occurrence.revision + 1, updatedAt: input.at };
        tx.update(occurrences).set({ dueDate: input.dueDate, time: input.time, revision: moved.revision, updatedAt: input.at }).where(eq(occurrences.id, occurrence.id)).run();
        refreshReminders(tx, moved, schedule, input.at);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_MOVED', actor, input.at, { to: input.dueDate }));
        return 'ok';
      });
    },

    assign(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (occurrence.state !== 'OPEN' && occurrence.state !== 'IN_PROGRESS') return 'closed';
        if (!assigneeAllowed(tx, input.workspaceId, input.assigneeUserId)) return 'invalid_assignee';
        const assigned = { ...occurrence, assigneeUserId: input.assigneeUserId, revision: occurrence.revision + 1, updatedAt: input.at };
        tx.update(occurrences).set({ assigneeUserId: input.assigneeUserId, revision: assigned.revision, updatedAt: input.at }).where(eq(occurrences.id, occurrence.id)).run();
        refreshReminders(tx, assigned, schedule, input.at);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_ASSIGNED', actor, input.at, { assigned: input.assigneeUserId !== null }));
        return 'ok';
      });
    },

    linkRun(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        if (schedule.kind !== 'PROCEDURE') return 'wrong_kind';
        if (occurrence.state !== 'OPEN') return 'closed';
        const run = tx
          .select()
          .from(runs)
          .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.id, input.runId)))
          .get();
        if (run === undefined || !eligibleRun(tx, schedule, occurrence, run)) return 'run_not_eligible';
        tx.insert(occurrenceRuns)
          .values({
            id: randomUUID(),
            occurrenceId: occurrence.id,
            runId: run.id,
            workspaceId: input.workspaceId,
            how: 'LINKED',
            linkedAt: input.at,
            linkedByUserId: actor.userId,
            linkedByDisplayName: actor.displayName,
          })
          .run();
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_RUN_LINKED', actor, input.at, { runState: run.state }, run.id));
        if (run.state === 'COMPLETED' && run.endedAt !== null && run.endedByUserId !== null && run.endedByDisplayName !== null) {
          // Completed by whoever completed the Run.
          closeOccurrence(tx, occurrence, 'COMPLETED', { userId: run.endedByUserId, displayName: run.endedByDisplayName }, input.at, null);
          createNextAfterCompletion(tx, schedule, run.endedAt, input.at);
        } else {
          tx.update(occurrences).set({ state: 'IN_PROGRESS', revision: occurrence.revision + 1, updatedAt: input.at }).where(eq(occurrences.id, occurrence.id)).run();
          cancelReminders(tx, occurrence.id, input.at);
        }
        return 'ok';
      });
    },

    unlinkRun(input, actor, guard) {
      return occurrenceWrite(input, actor, guard, (tx, occurrence, schedule) => {
        const link = tx.select().from(occurrenceRuns).where(and(eq(occurrenceRuns.occurrenceId, occurrence.id), isNull(occurrenceRuns.endedAt))).get();
        if (link === undefined) return 'closed';
        if (occurrence.state === 'COMPLETED' && !withdrawNextAfter(tx, schedule, occurrence, actor, input.at)) return 'next_in_use';
        tx.update(occurrenceRuns).set({ endedAt: input.at, endReason: 'UNLINKED' }).where(eq(occurrenceRuns.id, link.id)).run();
        const reopened = { ...occurrence, state: 'OPEN' as const, closedAt: null, closedByUserId: null, closedByDisplayName: null, revision: occurrence.revision + 1, updatedAt: input.at };
        tx.update(occurrences)
          .set({ state: 'OPEN', closedAt: null, closedByUserId: null, closedByDisplayName: null, revision: reopened.revision, updatedAt: input.at })
          .where(eq(occurrences.id, occurrence.id))
          .run();
        refreshReminders(tx, reopened, schedule, input.at);
        recordAuditEvent(tx, occurrenceAudit(occurrence, 'OCCURRENCE_RUN_UNLINKED', actor, input.at, {}, link.runId));
        return 'ok';
      });
    },

    async findSchedule(workspaceId, scheduleId) {
      return findScheduleIn(db, workspaceId, scheduleId);
    },

    async findOccurrence(workspaceId, occurrenceId) {
      return findOccurrenceIn(db, workspaceId, occurrenceId);
    },

    async listSchedules(workspaceId, limit) {
      return selectSchedules(db)
        .where(and(enabledScheduleSource, eq(schedules.workspaceId, workspaceId), inArray(schedules.state, ['ACTIVE', 'PAUSED'])))
        .orderBy(asc(schedules.createdAt))
        .limit(limit)
        .all()
        .map(toSchedule);
    },

    async history(workspaceId, scheduleId, limit) {
      const items = selectOccurrences(db)
        .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), eq(occurrences.scheduleId, scheduleId)))
        .orderBy(desc(occurrences.dueDate), desc(occurrences.createdAt))
        .limit(limit)
        .all()
        .map(toOccurrence);
      const links =
        items.length === 0
          ? []
          : db
              .select()
              .from(occurrenceRuns)
              .where(inArray(occurrenceRuns.occurrenceId, items.map((item) => item.occurrence.id)))
              .orderBy(desc(occurrenceRuns.linkedAt))
              .all();
      return items.map(
        (item): OccurrenceHistoryEntry => ({
          ...item,
          runs: links
            .filter((link) => link.occurrenceId === item.occurrence.id)
            .map((link) => ({ runId: link.runId as RunId, how: link.how, linkedAt: link.linkedAt, linkedBy: link.linkedByDisplayName, ended: link.endReason })),
        }),
      );
    },

    async listOpen(workspaceId, limit) {
      return selectOccurrences(db)
        .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), inArray(occurrences.state, ['OPEN', 'IN_PROGRESS'])))
        .orderBy(asc(occurrences.dueDate), asc(occurrences.time), asc(occurrences.createdAt))
        .limit(limit)
        .all()
        .map(toOccurrence);
    },

    async listRecentlyClosed(workspaceId, since, limit) {
      return selectOccurrences(db)
        .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), inArray(occurrences.state, ['COMPLETED', 'SKIPPED']), gte(occurrences.closedAt, since)))
        .orderBy(desc(occurrences.closedAt))
        .limit(limit)
        .all()
        .map(toOccurrence);
    },

    async listDueBetween(workspaceId, from, to, limit) {
      return selectOccurrences(db)
        .where(and(enabledScheduleSource, eq(occurrences.workspaceId, workspaceId), ne(occurrences.state, 'CANCELLED'), gte(occurrences.dueDate, from), lte(occurrences.dueDate, to)))
        .orderBy(asc(occurrences.dueDate), asc(occurrences.time), asc(occurrences.createdAt))
        .limit(limit)
        .all()
        .map(toOccurrence);
    },

    async listFixedSeries(workspaceId, limit) {
      // The same series the generator (`advance`) continues, and the same "latest" it continues from.
      const series = selectSchedules(db)
        .where(
          and(
            enabledScheduleSource,
            eq(schedules.workspaceId, workspaceId),
            eq(schedules.state, 'ACTIVE'),
            eq(schedules.recurrenceKind, 'FIXED'),
            or(isNull(schedules.procedureId), isNull(procedures.deletedAt)),
          ),
        )
        .orderBy(asc(schedules.createdAt))
        .limit(limit)
        .all();
      const latest = new Map(
        db
          .select({ scheduleId: occurrences.scheduleId, due: max(occurrences.dueDate) })
          .from(occurrences)
          .where(and(eq(occurrences.workspaceId, workspaceId), ne(occurrences.state, 'CANCELLED')))
          .groupBy(occurrences.scheduleId)
          .all()
          .map((row) => [row.scheduleId, row.due]),
      );
      return series.map((row) => ({ schedule: toSchedule(row), latestDueDate: (latest.get(row.schedule.id) ?? null) as LocalDate | null }));
    },

    async linkableRuns(workspaceId, occurrenceId) {
      return db.transaction((tx) => {
        const row = occurrenceRowIn(tx, workspaceId, occurrenceId);
        if (row === undefined || row.schedule.kind !== 'PROCEDURE' || row.schedule.procedureId === null) return [];
        const candidates = tx
          .select()
          .from(runs)
          .where(and(eq(runs.workspaceId, workspaceId), eq(runs.procedureId, row.schedule.procedureId), inArray(runs.state, ['ACTIVE', 'COMPLETED'])))
          .orderBy(desc(runs.startedAt))
          .limit(50)
          .all()
          .filter((run) => eligibleRun(tx, row.schedule, row.occurrence, run));
        const counts =
          candidates.length === 0
            ? []
            : tx
                .select({ runId: runSteps.runId, state: runSteps.state, n: sql<number>`count(*)` })
                .from(runSteps)
                .where(inArray(runSteps.runId, candidates.map((run) => run.id)))
                .groupBy(runSteps.runId, runSteps.state)
                .all();
        return candidates.map((run): RunSummary => {
          const stepCounts = Object.fromEntries(STEP_STATES.map((state) => [state, 0])) as Record<StepState, number>;
          for (const entry of counts) if (entry.runId === run.id) stepCounts[entry.state] = entry.n;
          return { run: toRun(run), stepCounts };
        });
      });
    },

    async advance(now, limit) {
      const candidates = db
        .select()
        .from(schedules)
        .leftJoin(procedures, eq(procedures.id, schedules.procedureId))
        .where(and(enabledScheduleSource, eq(schedules.state, 'ACTIVE'), eq(schedules.recurrenceKind, 'FIXED'), or(isNull(schedules.procedureId), isNull(procedures.deletedAt))))
        .all();
      let created = 0;
      for (const { schedules: schedule } of candidates) {
        if (created >= limit) break;
        const latest = latestDueDate(db, schedule.id);
        if (latest !== undefined && latest >= todayOf(schedule, now)) continue;
        created += db.transaction((tx) => {
          if (!toolEnabled(tx, schedule.workspaceId, schedule.kind === 'PROCEDURE' ? 'PROCEDURES' : 'REMINDERS')) return 0;
          // Re-read inside the write lock: another worker may have advanced it meanwhile (idempotent anyway).
          const fresh = scheduleRowIn(tx, schedule.workspaceId, schedule.id);
          return fresh === undefined ? 0 : ensureFixedOccurrences(tx, fresh, now).length;
        }, IMMEDIATE);
      }
      return created;
    },
  };
}

/**
 * D7: a Run may be linked if it belongs to the Schedule's Procedure in the same Workspace, is ACTIVE or
 * COMPLETED, is not linked to any Occurrence, and started on or after the previous Occurrence's due date
 * (or the Schedule's creation).
 */
function eligibleRun(tx: Reader, schedule: ScheduleRow, occurrence: OccurrenceRow, run: typeof runs.$inferSelect): boolean {
  if (run.workspaceId !== schedule.workspaceId || run.procedureId !== schedule.procedureId) return false;
  if (run.state !== 'ACTIVE' && run.state !== 'COMPLETED') return false;
  const linked = tx.select({ id: occurrenceRuns.id }).from(occurrenceRuns).where(and(eq(occurrenceRuns.runId, run.id), isNull(occurrenceRuns.endedAt))).get();
  if (linked !== undefined) return false;
  const previous = tx
    .select({ due: occurrences.dueDate })
    .from(occurrences)
    .where(and(eq(occurrences.scheduleId, schedule.id), ne(occurrences.state, 'CANCELLED'), lt(occurrences.dueDate, occurrence.dueDate)))
    .orderBy(desc(occurrences.dueDate))
    .limit(1)
    .get();
  const since = previous === undefined ? schedule.createdAt : zonedInstant(previous.due as LocalDate, '00:00' as LocalTime, schedule.timeZone as TimeZoneName);
  return run.startedAt.getTime() >= since.getTime();
}
