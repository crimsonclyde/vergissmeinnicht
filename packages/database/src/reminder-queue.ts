import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import type { CatchUpSummary, DeliveryClaim, DueReminder, ReminderQueue } from '@vergissmeinnicht/application';
import type { LocalDate, LocalTime, TimeZoneName } from '@vergissmeinnicht/domain';
import { IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { memberships, notificationSummaries, occurrences, procedures, reminderDeliveries, scheduledReminders, schedules, users, workspaces } from './schema.ts';
import { toUser } from './user-repository.ts';

const FINAL = ['SENT', 'FAILED', 'SKIPPED'] as const;
const isFinal = (status: string) => (FINAL as readonly string[]).includes(status);

type Reader = Pick<Transaction, 'select'>;

/** A reminder with everything the dispatcher needs to decide and to write the message. */
function selectDue(tx: Reader) {
  return tx
    .select({
      reminder: scheduledReminders,
      occurrence: occurrences,
      schedule: schedules,
      procedure: { title: procedures.title, deletedAt: procedures.deletedAt },
      workspaceName: workspaces.name,
      recipient: users,
      role: memberships.role,
      inDelivery: sql<number>`exists (select 1 from ${reminderDeliveries} where ${reminderDeliveries.reminderId} = ${scheduledReminders.id})`,
    })
    .from(scheduledReminders)
    .innerJoin(occurrences, eq(occurrences.id, scheduledReminders.occurrenceId))
    .innerJoin(schedules, eq(schedules.id, occurrences.scheduleId))
    .leftJoin(procedures, eq(procedures.id, schedules.procedureId))
    .innerJoin(workspaces, eq(workspaces.id, schedules.workspaceId))
    .innerJoin(users, eq(users.id, scheduledReminders.recipientUserId))
    .leftJoin(memberships, and(eq(memberships.workspaceId, schedules.workspaceId), eq(memberships.userId, scheduledReminders.recipientUserId)));
}

type DueRow = Awaited<ReturnType<ReturnType<typeof selectDue>['all']>>[number];

function toDue(row: DueRow): DueReminder {
  return {
    reminderId: row.reminder.id,
    reminderKey: row.reminder.reminderKey,
    remindAt: row.reminder.remindAt,
    occurrence: {
      id: row.occurrence.id,
      state: row.occurrence.state,
      dueDate: row.occurrence.dueDate as LocalDate,
      time: row.occurrence.time as LocalTime | null,
      assigneeUserId: row.occurrence.assigneeUserId,
    },
    schedule: {
      id: row.schedule.id,
      kind: row.schedule.kind,
      state: row.schedule.state,
      workspaceId: row.schedule.workspaceId,
      workspaceName: row.workspaceName,
      title: row.schedule.title ?? row.procedure?.title ?? '',
      procedureDeleted: row.procedure?.deletedAt != null,
      timeZone: row.schedule.timeZone as TimeZoneName,
      assigneeUserId: row.schedule.assigneeUserId,
      createdByUserId: row.schedule.createdByUserId,
    },
    recipient: toUser(row.recipient),
    recipientRole: row.role,
    inDelivery: Number(row.inDelivery) === 1,
  };
}

/** Durable reminder state for the dispatcher (13.5, 14.1). See `ReminderQueue` for the guarantees. */
export function createReminderQueue({ db }: Pick<AppDatabase, 'db'>): ReminderQueue {
  const finish = (deliveryId: string, set: Partial<typeof reminderDeliveries.$inferInsert>) => {
    db.update(reminderDeliveries).set(set).where(eq(reminderDeliveries.id, deliveryId)).run();
  };

  /** A summary and its GROUPED members take the same final outcome, in one transaction. */
  const finishSummary = (summaryId: string, now: Date, summary: Partial<typeof notificationSummaries.$inferInsert>, members: Partial<typeof reminderDeliveries.$inferInsert> | null) => {
    db.transaction((tx) => {
      tx.update(notificationSummaries)
        .set({ ...summary, updatedAt: now })
        .where(eq(notificationSummaries.id, summaryId))
        .run();
      if (members !== null) {
        tx.update(reminderDeliveries)
          .set({ ...members, updatedAt: now })
          .where(and(eq(reminderDeliveries.summaryId, summaryId), eq(reminderDeliveries.status, 'GROUPED')))
          .run();
      }
    }, IMMEDIATE);
  };

  const unprocessed = and(isNull(scheduledReminders.processedAt), isNull(scheduledReminders.cancelledAt));

  return {
    async due(now, limit) {
      return selectDue(db)
        .where(
          and(
            unprocessed,
            lte(scheduledReminders.remindAt, now),
            or(isNull(scheduledReminders.nextAttemptAt), lte(scheduledReminders.nextAttemptAt, now)),
            // Members of a catch-up summary are finished by the summary.
            notExists(
              db
                .select({ id: reminderDeliveries.id })
                .from(reminderDeliveries)
                .where(and(eq(reminderDeliveries.reminderId, scheduledReminders.id), eq(reminderDeliveries.status, 'GROUPED'))),
            ),
          ),
        )
        .orderBy(asc(scheduledReminders.remindAt), asc(scheduledReminders.id))
        .limit(limit)
        .all()
        .map(toDue);
    },

    async claim(reminderId, channel, now, leaseMs) {
      return db.transaction((tx): DeliveryClaim => {
        const existing = tx
          .select()
          .from(reminderDeliveries)
          .where(and(eq(reminderDeliveries.reminderId, reminderId), eq(reminderDeliveries.channel, channel)))
          .get();
        const lease = new Date(now.getTime() + leaseMs);
        if (existing === undefined) {
          const id = randomUUID();
          tx.insert(reminderDeliveries).values({ id, reminderId, channel, status: 'SENDING', attempts: 1, nextAttemptAt: lease, updatedAt: now }).run();
          return { status: 'claimed', deliveryId: id, attempt: 1 };
        }
        if (isFinal(existing.status) || existing.status === 'GROUPED') return { status: 'final' };
        // RETRY whose time has come, or a SENDING claim whose lease expired (interrupted, e.g. a crash).
        if (existing.nextAttemptAt !== null && existing.nextAttemptAt.getTime() > now.getTime()) return { status: 'busy' };
        const attempt = existing.attempts + 1;
        const taken = tx
          .update(reminderDeliveries)
          .set({ status: 'SENDING', attempts: attempt, nextAttemptAt: lease, updatedAt: now })
          .where(and(eq(reminderDeliveries.id, existing.id), eq(reminderDeliveries.attempts, existing.attempts)))
          .returning({ id: reminderDeliveries.id })
          .get();
        return taken === undefined ? { status: 'busy' } : { status: 'claimed', deliveryId: existing.id, attempt };
      }, IMMEDIATE);
    },

    async sent(deliveryId, now) {
      finish(deliveryId, { status: 'SENT', sentAt: now, nextAttemptAt: null, updatedAt: now, errorCode: null });
    },

    async retry(deliveryId, now, nextAttemptAt, errorCode) {
      finish(deliveryId, { status: 'RETRY', nextAttemptAt, updatedAt: now, errorCode: errorCode.slice(0, 40) });
    },

    async failed(deliveryId, now, errorCode) {
      finish(deliveryId, { status: 'FAILED', nextAttemptAt: null, updatedAt: now, errorCode: errorCode.slice(0, 40) });
    },

    async skipped(deliveryId, now, reason) {
      finish(deliveryId, { status: 'SKIPPED', nextAttemptAt: null, updatedAt: now, errorCode: reason.slice(0, 40) });
    },

    async settle(reminderId, channels, now) {
      db.transaction((tx) => {
        const deliveries =
          channels.length === 0
            ? []
            : tx
                .select({ status: reminderDeliveries.status, nextAttemptAt: reminderDeliveries.nextAttemptAt })
                .from(reminderDeliveries)
                .where(and(eq(reminderDeliveries.reminderId, reminderId), inArray(reminderDeliveries.channel, [...channels])))
                .all();
        const open = deliveries.filter((delivery) => !isFinal(delivery.status));
        if (deliveries.length === channels.length && open.length === 0) {
          tx.update(scheduledReminders).set({ processedAt: now, nextAttemptAt: null }).where(eq(scheduledReminders.id, reminderId)).run();
          return;
        }
        const next = open.map((delivery) => delivery.nextAttemptAt?.getTime() ?? now.getTime()).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
        tx.update(scheduledReminders)
          .set({ nextAttemptAt: Number.isFinite(next) ? new Date(next) : null })
          .where(eq(scheduledReminders.id, reminderId))
          .run();
      }, IMMEDIATE);
    },

    async missed(occurrenceId, recipientUserId, now, staleMs) {
      return db
        .select({ reminderId: scheduledReminders.id, remindAt: scheduledReminders.remindAt })
        .from(scheduledReminders)
        .where(
          and(
            unprocessed,
            eq(scheduledReminders.occurrenceId, occurrenceId),
            eq(scheduledReminders.recipientUserId, recipientUserId),
            lte(scheduledReminders.remindAt, new Date(now.getTime() - staleMs)),
            notExists(db.select({ id: reminderDeliveries.id }).from(reminderDeliveries).where(eq(reminderDeliveries.reminderId, scheduledReminders.id))),
          ),
        )
        .orderBy(asc(scheduledReminders.remindAt))
        .all();
    },

    async hasNormalReminder(occurrenceId, recipientUserId, now, staleMs, windowMs) {
      return (
        db
          .select({ id: scheduledReminders.id })
          .from(scheduledReminders)
          .where(
            and(
              unprocessed,
              eq(scheduledReminders.occurrenceId, occurrenceId),
              eq(scheduledReminders.recipientUserId, recipientUserId),
              gt(scheduledReminders.remindAt, new Date(now.getTime() - staleMs)),
              lte(scheduledReminders.remindAt, new Date(now.getTime() + windowMs)),
            ),
          )
          .get() !== undefined
      );
    },

    async supersede(reminderIds, now) {
      if (reminderIds.length === 0) return;
      db.update(scheduledReminders)
        .set({ processedAt: now, supersededAt: now, nextAttemptAt: null })
        .where(and(inArray(scheduledReminders.id, [...reminderIds]), isNull(scheduledReminders.processedAt)))
        .run();
    },

    async groupIntoSummary(recipientUserId, channel, reminderIds, now, leaseMs) {
      return db.transaction((tx): string | null => {
        if (reminderIds.length === 0) return null;
        // Only reminders still waiting and without a delivery on this channel (unique per reminder and channel).
        const open = tx
          .select({ id: scheduledReminders.id })
          .from(scheduledReminders)
          .where(and(inArray(scheduledReminders.id, [...reminderIds]), unprocessed))
          .all()
          .map((row) => row.id);
        const taken = new Set(
          open.length === 0
            ? []
            : tx
                .select({ reminderId: reminderDeliveries.reminderId })
                .from(reminderDeliveries)
                .where(and(inArray(reminderDeliveries.reminderId, open), eq(reminderDeliveries.channel, channel)))
                .all()
                .map((row) => row.reminderId),
        );
        const members = open.filter((id) => !taken.has(id));
        if (members.length === 0) return null;
        const summaryId = randomUUID();
        tx.insert(notificationSummaries)
          .values({ id: summaryId, recipientUserId, channel, status: 'SENDING', attempts: 1, nextAttemptAt: new Date(now.getTime() + leaseMs), createdAt: now, updatedAt: now })
          .run();
        for (const reminderId of members) {
          tx.insert(reminderDeliveries)
            .values({ id: randomUUID(), reminderId, channel, status: 'GROUPED', attempts: 1, updatedAt: now, summaryId })
            .run();
        }
        return summaryId;
      }, IMMEDIATE);
    },

    async dueSummaries(now, limit) {
      return db
        .select({ id: notificationSummaries.id })
        .from(notificationSummaries)
        .where(and(inArray(notificationSummaries.status, ['SENDING', 'RETRY']), lte(notificationSummaries.nextAttemptAt, now)))
        .orderBy(asc(notificationSummaries.nextAttemptAt))
        .limit(limit)
        .all()
        .map((row) => row.id);
    },

    async claimSummary(summaryId, now, leaseMs) {
      return db.transaction((tx): DeliveryClaim => {
        const existing = tx.select().from(notificationSummaries).where(eq(notificationSummaries.id, summaryId)).get();
        if (existing === undefined || isFinal(existing.status)) return { status: 'final' };
        if (existing.nextAttemptAt !== null && existing.nextAttemptAt.getTime() > now.getTime()) return { status: 'busy' };
        const attempt = existing.attempts + 1;
        const taken = tx
          .update(notificationSummaries)
          .set({ status: 'SENDING', attempts: attempt, nextAttemptAt: new Date(now.getTime() + leaseMs), updatedAt: now })
          .where(and(eq(notificationSummaries.id, summaryId), eq(notificationSummaries.attempts, existing.attempts)))
          .returning({ id: notificationSummaries.id })
          .get();
        return taken === undefined ? { status: 'busy' } : { status: 'claimed', deliveryId: summaryId, attempt };
      }, IMMEDIATE);
    },

    async summary(summaryId) {
      const head = db.select().from(notificationSummaries).innerJoin(users, eq(users.id, notificationSummaries.recipientUserId)).where(eq(notificationSummaries.id, summaryId)).get();
      if (head === undefined) return undefined;
      const deliveries = db
        .select({ id: reminderDeliveries.id, reminderId: reminderDeliveries.reminderId })
        .from(reminderDeliveries)
        .where(and(eq(reminderDeliveries.summaryId, summaryId), eq(reminderDeliveries.status, 'GROUPED')))
        .all();
      const deliveryOf = new Map(deliveries.map((delivery) => [delivery.reminderId, delivery.id]));
      const members =
        deliveries.length === 0
          ? []
          : selectDue(db)
              .where(inArray(scheduledReminders.id, [...deliveryOf.keys()]))
              .all()
              .map((row) => ({ ...toDue(row), deliveryId: deliveryOf.get(row.reminder.id) ?? '' }));
      return { summaryId, channel: head.notification_summaries.channel, recipient: toUser(head.users), members } satisfies CatchUpSummary;
    },

    async dropFromSummary(deliveryIds, now, reason) {
      if (deliveryIds.length === 0) return;
      db.update(reminderDeliveries)
        .set({ status: 'SKIPPED', errorCode: reason.slice(0, 40), nextAttemptAt: null, updatedAt: now })
        .where(and(inArray(reminderDeliveries.id, [...deliveryIds]), eq(reminderDeliveries.status, 'GROUPED')))
        .run();
    },

    async summarySent(summaryId, now) {
      finishSummary(summaryId, now, { status: 'SENT', sentAt: now, nextAttemptAt: null, errorCode: null }, { status: 'SENT', sentAt: now, nextAttemptAt: null });
    },

    async summaryRetry(summaryId, now, nextAttemptAt, errorCode) {
      finishSummary(summaryId, now, { status: 'RETRY', nextAttemptAt, errorCode: errorCode.slice(0, 40) }, null);
    },

    async summaryFailed(summaryId, now, errorCode) {
      finishSummary(summaryId, now, { status: 'FAILED', nextAttemptAt: null, errorCode: errorCode.slice(0, 40) }, { status: 'FAILED', nextAttemptAt: null, errorCode: errorCode.slice(0, 40) });
    },

    async summarySkipped(summaryId, now, reason) {
      finishSummary(summaryId, now, { status: 'SKIPPED', nextAttemptAt: null, errorCode: reason.slice(0, 40) }, { status: 'SKIPPED', nextAttemptAt: null, errorCode: reason.slice(0, 40) });
    },

    async settleDelivered(reminderId, now) {
      db.transaction((tx) => {
        const statuses = tx.select({ status: reminderDeliveries.status }).from(reminderDeliveries).where(eq(reminderDeliveries.reminderId, reminderId)).all();
        if (statuses.every((row) => isFinal(row.status))) {
          tx.update(scheduledReminders)
            .set({ processedAt: now, nextAttemptAt: null })
            .where(and(eq(scheduledReminders.id, reminderId), isNull(scheduledReminders.processedAt)))
            .run();
        }
      }, IMMEDIATE);
    },
  };
}
