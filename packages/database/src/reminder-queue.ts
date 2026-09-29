import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { DeliveryClaim, DueReminder, ReminderQueue } from '@vergissmeinnicht/application';
import type { LocalDate, LocalTime, TimeZoneName } from '@vergissmeinnicht/domain';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { memberships, procedures, reminderDeliveries, scheduledProcedures, scheduledReminders, users, workspaces } from './schema.ts';
import { toUser } from './user-repository.ts';

const FINAL = ['SENT', 'FAILED', 'SKIPPED'] as const;

/** Durable reminder state for the dispatcher (13.5). See `ReminderQueue` for the guarantees. */
export function createReminderQueue({ db }: Pick<AppDatabase, 'db'>): ReminderQueue {
  const finish = (deliveryId: string, set: Partial<typeof reminderDeliveries.$inferInsert>) => {
    db.update(reminderDeliveries).set(set).where(eq(reminderDeliveries.id, deliveryId)).run();
  };

  return {
    async due(now, limit) {
      const rows = db
        .select({
          reminder: scheduledReminders,
          schedule: scheduledProcedures,
          procedure: { title: procedures.title, deletedAt: procedures.deletedAt },
          workspaceName: workspaces.name,
          recipient: users,
          role: memberships.role,
        })
        .from(scheduledReminders)
        .innerJoin(scheduledProcedures, eq(scheduledProcedures.id, scheduledReminders.scheduleId))
        .innerJoin(procedures, eq(procedures.id, scheduledProcedures.procedureId))
        .innerJoin(workspaces, eq(workspaces.id, scheduledProcedures.workspaceId))
        .innerJoin(users, eq(users.id, scheduledReminders.recipientUserId))
        .leftJoin(memberships, and(eq(memberships.workspaceId, scheduledProcedures.workspaceId), eq(memberships.userId, scheduledReminders.recipientUserId)))
        .where(
          and(
            isNull(scheduledReminders.processedAt),
            isNull(scheduledReminders.cancelledAt),
            lte(scheduledReminders.remindAt, now),
            or(isNull(scheduledReminders.nextAttemptAt), lte(scheduledReminders.nextAttemptAt, now)),
          ),
        )
        .orderBy(asc(scheduledReminders.remindAt), asc(scheduledReminders.id))
        .limit(limit)
        .all();
      return rows.map(
        (row): DueReminder => ({
          reminderId: row.reminder.id,
          reminderKey: row.reminder.reminderKey,
          remindAt: row.reminder.remindAt,
          schedule: {
            id: row.schedule.id,
            state: row.schedule.state,
            workspaceId: row.schedule.workspaceId,
            workspaceName: row.workspaceName,
            procedureTitle: row.procedure.title,
            procedureDeleted: row.procedure.deletedAt !== null,
            date: row.schedule.date as LocalDate,
            time: row.schedule.time as LocalTime | null,
            timeZone: row.schedule.timeZone as TimeZoneName,
          },
          recipient: toUser(row.recipient),
          recipientRole: row.role,
        }),
      );
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
          tx.insert(reminderDeliveries)
            .values({ id, reminderId, channel, status: 'SENDING', attempts: 1, nextAttemptAt: lease, updatedAt: now })
            .run();
          return { status: 'claimed', deliveryId: id, attempt: 1 };
        }
        if ((FINAL as readonly string[]).includes(existing.status)) return { status: 'final' };
        // RETRY whose time has come, or a SENDING claim whose lease expired (interrupted, e.g. a crash).
        if (existing.nextAttemptAt !== null && existing.nextAttemptAt.getTime() > now.getTime()) return { status: 'busy' };
        const attempt = existing.attempts + 1;
        tx.update(reminderDeliveries)
          .set({ status: 'SENDING', attempts: attempt, nextAttemptAt: lease, updatedAt: now })
          .where(eq(reminderDeliveries.id, existing.id))
          .run();
        return { status: 'claimed', deliveryId: existing.id, attempt };
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
        const open = deliveries.filter((delivery) => !(FINAL as readonly string[]).includes(delivery.status));
        const allFinal = deliveries.length === channels.length && open.length === 0;
        if (allFinal) {
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
  };
}
