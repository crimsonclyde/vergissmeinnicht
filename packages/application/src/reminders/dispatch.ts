import { canAuthenticate, timelinessAt } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import type { Clock } from '../ports/clock.ts';
import { NotificationDeliveryError, type DueReminder, type ReminderMessage, type ReminderNotifier, type ReminderQueue } from '../ports/reminders.ts';

export interface ReminderDeps {
  readonly queue: ReminderQueue;
  readonly notifiers: readonly ReminderNotifier[];
  readonly clock: Clock;
  readonly publicOrigin: string;
}

/** Reminders handled per run of the dispatcher. */
export const REMINDER_BATCH = 50;
/** A claim not settled after this long counts as interrupted (e.g. a crash while sending). */
export const DELIVERY_LEASE_MS = 5 * 60_000;
/** At most this many attempts per reminder and channel — also across restarts. */
export const MAX_DELIVERY_ATTEMPTS = 4;
/** Waits before the 2nd, 3rd and 4th attempt. */
export const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000] as const;
/** A reminder not delivered within this time after it was due is dropped (the server was down). */
export const STALE_AFTER_MS = 24 * 60 * 60_000;

export interface DispatchResult {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
}

/**
 * The link in a reminder opens the Workspace's Home, where the item is shown with Start. It is an
 * ordinary page URL: signing in is still required, and nothing in it grants access.
 */
export function reminderUrl(publicOrigin: string, workspaceId: string): string {
  return `${publicOrigin}/w/${encodeURIComponent(workspaceId)}`;
}

/**
 * Whether the recipient may still receive this reminder: an ACTIVE account, still a member who may
 * see the Workspace's Procedures, the item still open and its Procedure not deleted. Checked at
 * send time — a removed member never receives Workspace content again.
 */
export function mayReceive(reminder: DueReminder): boolean {
  return (
    canAuthenticate(reminder.recipient) &&
    reminder.recipientRole !== null &&
    roleHasCapability(reminder.recipientRole, 'procedure.view') &&
    reminder.schedule.state === 'SCHEDULED' &&
    !reminder.schedule.procedureDeleted
  );
}

/**
 * Sends the reminders whose time has come (13.5), through every channel the recipient enabled.
 * Idempotent: each (reminder, channel) is claimed in the database before sending, so a restart or
 * an overlapping run never sends it twice; transient failures are retried a bounded number of times.
 * Delivery never changes Procedures, Runs or their history.
 */
export async function dispatchDueReminders(deps: ReminderDeps): Promise<DispatchResult> {
  const counts = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  const now = deps.clock.now();
  for (const reminder of await deps.queue.due(now, REMINDER_BATCH)) {
    if (!mayReceive(reminder)) {
      await deps.queue.settle(reminder.reminderId, [], now);
      counts.skipped++;
      continue;
    }
    const channels: ReminderNotifier[] = [];
    for (const notifier of deps.notifiers) {
      if (await notifier.enabledFor(reminder.recipient)) channels.push(notifier);
    }
    const message: ReminderMessage = {
      procedureTitle: reminder.schedule.procedureTitle,
      workspaceName: reminder.schedule.workspaceName,
      date: reminder.schedule.date,
      time: reminder.schedule.time,
      timeZone: reminder.schedule.timeZone,
      reminderKey: reminder.reminderKey,
      overdue: timelinessAt(reminder.schedule, now) === 'OVERDUE',
      url: reminderUrl(deps.publicOrigin, reminder.schedule.workspaceId),
    };
    for (const notifier of channels) {
      const claim = await deps.queue.claim(reminder.reminderId, notifier.channel, now, DELIVERY_LEASE_MS);
      if (claim.status !== 'claimed') continue;
      if (claim.attempt === 1 && now.getTime() - reminder.remindAt.getTime() > STALE_AFTER_MS) {
        await deps.queue.skipped(claim.deliveryId, now, 'stale');
        counts.skipped++;
        continue;
      }
      try {
        await notifier.send(reminder.recipient, message);
        await deps.queue.sent(claim.deliveryId, now);
        counts.sent++;
      } catch (error) {
        const code = error instanceof NotificationDeliveryError ? error.code : 'unexpected';
        const transient = error instanceof NotificationDeliveryError ? error.transient : true;
        const delay = RETRY_DELAYS_MS[claim.attempt - 1];
        if (transient && claim.attempt < MAX_DELIVERY_ATTEMPTS && delay !== undefined) {
          await deps.queue.retry(claim.deliveryId, now, new Date(now.getTime() + delay), code);
          counts.retried++;
        } else {
          await deps.queue.failed(claim.deliveryId, now, code);
          counts.failed++;
        }
      }
    }
    await deps.queue.settle(
      reminder.reminderId,
      channels.map((notifier) => notifier.channel),
      now,
    );
  }
  return counts;
}
