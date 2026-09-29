import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { ScheduleRepository, ScheduleTimingInput, ScheduleWriteResult } from '@vergissmeinnicht/application';
import type {
  LocalDate,
  LocalTime,
  ProcedureIcon,
  ProcedureId,
  RunId,
  ScheduledProcedure,
  ScheduledProcedureId,
  TimeZoneName,
  UserId,
  WorkspaceId,
} from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { activeIn } from './procedure-repository.ts';
import { procedures, scheduledProcedures, scheduledReminders } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type Row = { schedule: typeof scheduledProcedures.$inferSelect; procedure: { title: string; icon: string; deletedAt: Date | null } };

function toSchedule({ schedule, procedure }: Row): ScheduledProcedure {
  return {
    id: schedule.id as ScheduledProcedureId,
    workspaceId: schedule.workspaceId as WorkspaceId,
    procedureId: schedule.procedureId as ProcedureId,
    procedure: { title: procedure.title, icon: procedure.icon as ProcedureIcon, deleted: procedure.deletedAt !== null },
    date: schedule.date as LocalDate,
    time: schedule.time as LocalTime | null,
    timeZone: schedule.timeZone as TimeZoneName,
    reminderTime: schedule.reminderTime as LocalTime,
    reminders: schedule.reminders,
    state: schedule.state,
    revision: schedule.revision,
    createdAt: schedule.createdAt,
    createdBy: { userId: schedule.createdByUserId as UserId, displayName: schedule.createdByDisplayName },
    runId: schedule.runId as RunId | null,
    closed:
      schedule.closedAt === null || schedule.closedByUserId === null || schedule.closedByDisplayName === null
        ? null
        : { at: schedule.closedAt, by: { userId: schedule.closedByUserId as UserId, displayName: schedule.closedByDisplayName } },
  };
}

function select(tx: Reader) {
  return tx
    .select({ schedule: scheduledProcedures, procedure: { title: procedures.title, icon: procedures.icon, deletedAt: procedures.deletedAt } })
    .from(scheduledProcedures)
    .innerJoin(procedures, eq(procedures.id, scheduledProcedures.procedureId));
}

function findIn(tx: Reader, workspaceId: WorkspaceId, scheduleId: string): ScheduledProcedure | undefined {
  const row = select(tx)
    .where(and(eq(scheduledProcedures.workspaceId, workspaceId), eq(scheduledProcedures.id, scheduleId)))
    .get();
  return row === undefined ? undefined : toSchedule(row);
}

/** Cancels the unsent reminders of an item (they stay as records; deliveries may reference them). */
export function cancelOpenReminders(tx: Transaction, scheduleId: string, at: Date): void {
  tx.update(scheduledReminders)
    .set({ cancelledAt: at })
    .where(and(eq(scheduledReminders.scheduleId, scheduleId), isNull(scheduledReminders.processedAt), isNull(scheduledReminders.cancelledAt)))
    .run();
}

/**
 * Stores the upcoming reminder instants for the item's creator. A reminder already processed for the
 * same key and instant (e.g. rescheduled back to the same moment) is not stored — it is never sent twice.
 */
function storeReminders(tx: Transaction, scheduleId: string, recipient: string, upcoming: ScheduleTimingInput['upcoming']): void {
  for (const reminder of upcoming) {
    tx.insert(scheduledReminders)
      .values({ id: randomUUID(), scheduleId, reminderKey: reminder.key, remindAt: reminder.at, recipientUserId: recipient })
      .onConflictDoUpdate({
        target: [scheduledReminders.scheduleId, scheduledReminders.reminderKey, scheduledReminders.remindAt],
        // A cancelled, unprocessed instant becomes active again; a processed one stays processed.
        set: { cancelledAt: null },
        setWhere: isNull(scheduledReminders.processedAt),
      })
      .run();
  }
}

function timingColumns(input: ScheduleTimingInput) {
  return { date: input.date, time: input.time, timeZone: input.timeZone, reminderTime: input.reminderTime, reminders: input.reminders.map((r) => ({ ...r })) };
}

export function createScheduleRepository({ db }: Pick<AppDatabase, 'db'>): ScheduleRepository {
  /** Loads an open item for a change, or the reason it cannot be changed. */
  const openForChange = (tx: Transaction, workspaceId: WorkspaceId, scheduleId: string, expectedRevision: number) => {
    const current = tx
      .select()
      .from(scheduledProcedures)
      .where(and(eq(scheduledProcedures.workspaceId, workspaceId), eq(scheduledProcedures.id, scheduleId)))
      .get();
    if (current === undefined) return { status: 'not_found' as const };
    if (current.state !== 'SCHEDULED') return { status: 'closed' as const };
    if (current.revision !== expectedRevision) return { status: 'conflict' as const };
    return { status: 'ok' as const, current };
  };

  return {
    async create(input, actor: UserActor, guard) {
      return db.transaction((tx): ScheduleWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const procedure = tx.select({ id: procedures.id, title: procedures.title }).from(procedures).where(activeIn(input.workspaceId, input.procedureId)).get();
        if (procedure === undefined) return { status: 'procedure_not_found' };
        const open =
          tx
            .select({ n: count() })
            .from(scheduledProcedures)
            .where(and(eq(scheduledProcedures.workspaceId, input.workspaceId), eq(scheduledProcedures.state, 'SCHEDULED')))
            .get()?.n ?? 0;
        if (open >= input.maxOpen) return { status: 'limit_reached' };
        const id = randomUUID();
        tx.insert(scheduledProcedures)
          .values({
            id,
            workspaceId: input.workspaceId,
            procedureId: procedure.id,
            ...timingColumns(input),
            state: 'SCHEDULED',
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .run();
        storeReminders(tx, id, actor.userId, input.upcoming);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'SCHEDULE_CREATED',
          actor,
          subjectType: 'schedule',
          subjectId: id,
          occurredAt: input.at,
          metadata: { procedureId: procedure.id, date: input.date, reminders: input.reminders.length },
        });
        return { status: 'ok', schedule: findIn(tx, input.workspaceId, id) as ScheduledProcedure };
      }, IMMEDIATE);
    },

    async reschedule(input, actor: UserActor, guard) {
      return db.transaction((tx): ScheduleWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const found = openForChange(tx, input.workspaceId, input.scheduleId, input.expectedRevision);
        if (found.status !== 'ok') return found;
        tx.update(scheduledProcedures)
          .set({ ...timingColumns(input), revision: found.current.revision + 1, updatedAt: input.at })
          .where(and(eq(scheduledProcedures.id, found.current.id), eq(scheduledProcedures.revision, input.expectedRevision)))
          .run();
        cancelOpenReminders(tx, found.current.id, input.at);
        // Reminders keep going to the person who scheduled the item.
        storeReminders(tx, found.current.id, found.current.createdByUserId, input.upcoming);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'SCHEDULE_CHANGED',
          actor,
          subjectType: 'schedule',
          subjectId: found.current.id,
          occurredAt: input.at,
          metadata: { fromDate: found.current.date, date: input.date, reminders: input.reminders.length },
        });
        return { status: 'ok', schedule: findIn(tx, input.workspaceId, found.current.id) as ScheduledProcedure };
      }, IMMEDIATE);
    },

    async cancel(input, actor: UserActor, guard) {
      return db.transaction((tx): ScheduleWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const found = openForChange(tx, input.workspaceId, input.scheduleId, input.expectedRevision);
        if (found.status !== 'ok') return found;
        tx.update(scheduledProcedures)
          .set({
            state: 'CANCELLED',
            revision: found.current.revision + 1,
            updatedAt: input.at,
            closedAt: input.at,
            closedByUserId: actor.userId,
            closedByDisplayName: actor.displayName,
          })
          .where(eq(scheduledProcedures.id, found.current.id))
          .run();
        cancelOpenReminders(tx, found.current.id, input.at);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'SCHEDULE_CANCELLED',
          actor,
          subjectType: 'schedule',
          subjectId: found.current.id,
          occurredAt: input.at,
          metadata: { procedureId: found.current.procedureId, date: found.current.date },
        });
        return { status: 'ok', schedule: findIn(tx, input.workspaceId, found.current.id) as ScheduledProcedure };
      }, IMMEDIATE);
    },

    async find(workspaceId, scheduleId) {
      return findIn(db, workspaceId, scheduleId);
    },

    async listOpen(workspaceId, limit) {
      return select(db)
        .where(and(eq(scheduledProcedures.workspaceId, workspaceId), eq(scheduledProcedures.state, 'SCHEDULED')))
        .orderBy(asc(scheduledProcedures.date), asc(scheduledProcedures.time), asc(scheduledProcedures.createdAt))
        .limit(limit)
        .all()
        .map(toSchedule);
    },
  };
}

/** Inside the Run start transaction (13.4), before the Run is written. */
export function scheduleIsOpen(tx: Reader, workspaceId: string, scheduleId: string, procedureId: string): boolean {
  return (
    tx
      .select({ id: scheduledProcedures.id })
      .from(scheduledProcedures)
      .where(
        and(
          eq(scheduledProcedures.workspaceId, workspaceId),
          eq(scheduledProcedures.id, scheduleId),
          eq(scheduledProcedures.procedureId, procedureId),
          eq(scheduledProcedures.state, 'SCHEDULED'),
        ),
      )
      .get() !== undefined
  );
}

/**
 * Inside the Run start transaction (13.4), after `scheduleIsOpen`: closes an open item of this Workspace for this Procedure as
 * STARTED with the new Run. Returns false if it is not open (started or cancelled meanwhile).
 */
export function closeScheduleAsStarted(tx: Transaction, input: { workspaceId: string; scheduleId: string; procedureId: string; runId: string; at: Date; actor: UserActor }): boolean {
  const current = tx
    .select()
    .from(scheduledProcedures)
    .where(
      and(
        eq(scheduledProcedures.workspaceId, input.workspaceId),
        eq(scheduledProcedures.id, input.scheduleId),
        eq(scheduledProcedures.procedureId, input.procedureId),
        eq(scheduledProcedures.state, 'SCHEDULED'),
      ),
    )
    .get();
  if (current === undefined) return false;
  tx.update(scheduledProcedures)
    .set({
      state: 'STARTED',
      runId: input.runId,
      revision: current.revision + 1,
      updatedAt: input.at,
      closedAt: input.at,
      closedByUserId: input.actor.userId,
      closedByDisplayName: input.actor.displayName,
    })
    .where(eq(scheduledProcedures.id, current.id))
    .run();
  cancelOpenReminders(tx, current.id, input.at);
  return true;
}
