import { canAuthenticate, daysBetween, dueInstant, localDateAt, reminderRecipientId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { emailTextsEn } from '../email-texts/en.ts';
import type { ReminderTextInput } from '../email-texts/email-texts.ts';
import type { Clock } from '../ports/clock.ts';
import { NotificationDeliveryError, type DeliveryClaim, type DueReminder, type NotificationChannel, type OutgoingNotification, type ReminderNotifier, type ReminderQueue } from '../ports/reminders.ts';

export interface ReminderDeps {
  readonly queue: ReminderQueue;
  readonly notifiers: readonly ReminderNotifier[];
  readonly clock: Clock;
  readonly publicOrigin: string;
}

/** Reminders handled per run of the dispatcher. */
export const REMINDER_BATCH = 50;
/** Catch-up summaries (retries) handled per run. */
export const SUMMARY_BATCH = 20;
/** A claim not settled after this long counts as interrupted (e.g. a crash while sending). */
export const DELIVERY_LEASE_MS = 5 * 60_000;
/** At most this many attempts per reminder (or summary) and channel — also across restarts. */
export const MAX_DELIVERY_ATTEMPTS = 4;
/** Waits before the 2nd, 3rd and 4th attempt. */
export const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000] as const;
/** Up to this late a reminder is delivered normally; later it was *missed* (the server was down) and becomes catch-up (D5). */
export const STALE_AFTER_MS = 24 * 60 * 60_000;
/** A catch-up is dropped when a normal reminder for the same Occurrence is due within this time. */
export const CATCH_UP_QUIET_MS = 24 * 60 * 60_000;
/** Items listed in one catch-up summary; the rest are counted ("and 12 more"). */
export const CATCH_UP_LISTED = 10;

export interface DispatchResult {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
  /** Missed reminders not sent because a later catch-up or a normal reminder covers them. */
  readonly superseded: number;
  /** Catch-up summaries sent. */
  readonly summaries: number;
}

/**
 * The link in a reminder opens the Workspace's Home, where the Occurrence is shown with its action. It
 * is an ordinary page URL: signing in is still required, and nothing in it grants access.
 */
export function reminderUrl(publicOrigin: string, workspaceId: string): string {
  return `${publicOrigin}/w/${encodeURIComponent(workspaceId)}`;
}

/**
 * Whether the recipient may still receive this reminder (checked at send time, also for catch-up): an
 * ACTIVE account, still a member who may see the Workspace's Procedures, still the person responsible
 * (Assignee, else creator), the Occurrence OPEN, its Schedule ACTIVE (not paused or ended) and a
 * Procedure not deleted. A removed member never receives Workspace content again.
 */
export function mayReceive(reminder: DueReminder): boolean {
  return (
    canAuthenticate(reminder.recipient) &&
    reminder.recipientRole !== null &&
    roleHasCapability(reminder.recipientRole, 'procedure.view') &&
    reminder.occurrence.state === 'OPEN' &&
    reminder.schedule.state === 'ACTIVE' &&
    !reminder.schedule.procedureDeleted &&
    reminderRecipientId(reminder.schedule, reminder.occurrence) === reminder.recipient.id
  );
}

/** What the item looks like *now* — the wording never repeats the original offset. */
function textInput(reminder: DueReminder, now: Date, url: string): ReminderTextInput {
  const { occurrence, schedule } = reminder;
  const daysUntil = daysBetween(localDateAt(now, schedule.timeZone), occurrence.dueDate);
  const hoursUntil = occurrence.time === null ? null : Math.floor((dueInstant({ ...occurrence, timeZone: schedule.timeZone }, occurrence.time).getTime() - now.getTime()) / 3_600_000);
  return {
    kind: schedule.kind,
    title: schedule.title,
    workspaceName: schedule.workspaceName,
    date: occurrence.dueDate,
    time: occurrence.time,
    timeZone: schedule.timeZone,
    daysUntil,
    hoursUntil: hoursUntil !== null && hoursUntil < 24 ? hoursUntil : null,
    url,
  };
}

/** Stable per logical notification (reminder + channel, or summary): the same key on every attempt. */
function messageKey(kind: 'r' | 's', id: string, channel: NotificationChannel): string {
  return `${kind}-${id}-${channel.toLowerCase()}`;
}

type Counts = { -readonly [K in keyof DispatchResult]: number };

/** Sends one claimed delivery or summary and records the outcome (bounded retries). */
async function deliver(
  send: () => Promise<void>,
  claim: Extract<DeliveryClaim, { status: 'claimed' }>,
  now: Date,
  outcome: { sent(): Promise<void>; retry(at: Date, code: string): Promise<void>; failed(code: string): Promise<void> },
  counts: Counts,
): Promise<boolean> {
  try {
    await send();
  } catch (error) {
    const code = error instanceof NotificationDeliveryError ? error.code : 'unexpected';
    const transient = error instanceof NotificationDeliveryError ? error.transient : true;
    const delay = RETRY_DELAYS_MS[claim.attempt - 1];
    if (transient && claim.attempt < MAX_DELIVERY_ATTEMPTS && delay !== undefined) {
      await outcome.retry(new Date(now.getTime() + delay), code);
      counts.retried++;
    } else {
      await outcome.failed(code);
      counts.failed++;
    }
    return false;
  }
  // Outside the provider's try: if recording fails (e.g. the process dies), the claim stays and its
  // lease expires — the documented, bounded repeat — instead of being mistaken for a provider failure.
  await outcome.sent();
  return true;
}

/**
 * Sends (or re-sends) a claimed catch-up summary. Every member is re-checked first; members that are
 * no longer eligible are dropped (SKIPPED), and an empty summary is not sent.
 */
async function sendSummary(deps: ReminderDeps, summaryId: string, claim: Extract<DeliveryClaim, { status: 'claimed' }>, now: Date, counts: Counts): Promise<void> {
  const summary = await deps.queue.summary(summaryId);
  if (summary === undefined) return;
  const eligible = summary.members.filter(mayReceive);
  const dropped = summary.members.filter((member) => !mayReceive(member));
  if (dropped.length > 0) await deps.queue.dropFromSummary(dropped.map((member) => member.deliveryId), now, 'not_eligible');
  const notifier = deps.notifiers.find((candidate) => candidate.channel === summary.channel);
  if (eligible.length === 0 || notifier === undefined || !(await notifier.enabledFor(summary.recipient))) {
    await deps.queue.summarySkipped(summaryId, now, eligible.length === 0 ? 'nothing_left' : 'channel_off');
    counts.skipped++;
  } else {
    const items = [...eligible]
      .sort((a, b) => a.occurrence.dueDate.localeCompare(b.occurrence.dueDate))
      .map((member) => textInput(member, now, ''));
    const input = { items: items.slice(0, CATCH_UP_LISTED), more: Math.max(0, items.length - CATCH_UP_LISTED), url: `${deps.publicOrigin}/` };
    const message: OutgoingNotification = { subject: emailTextsEn.catchUp.subject(input), body: emailTextsEn.catchUp.body(input), key: messageKey('s', summaryId, summary.channel) };
    const sent = await deliver(
      () => notifier.send(summary.recipient, message),
      claim,
      now,
      {
        sent: () => deps.queue.summarySent(summaryId, now),
        retry: (at, code) => deps.queue.summaryRetry(summaryId, now, at, code),
        failed: (code) => deps.queue.summaryFailed(summaryId, now, code),
      },
      counts,
    );
    if (sent) counts.summaries++;
  }
  for (const member of summary.members) await deps.queue.settleDelivered(member.reminderId, now);
}

/**
 * Missed reminders (more than 24 h late, D5): per Occurrence and recipient only the most recent missed
 * offset becomes a catch-up — earlier ones are superseded, and so is the catch-up when a normal reminder
 * for the same Occurrence is due within 24 h. Catch-ups are grouped into one summary per recipient and
 * channel, so an outage never floods anyone.
 */
async function catchUp(deps: ReminderDeps, missed: readonly DueReminder[], now: Date, counts: Counts): Promise<void> {
  const handled = new Set<string>();
  const byRecipient = new Map<string, { recipient: DueReminder['recipient']; reminderIds: string[] }>();
  for (const reminder of missed) {
    const key = `${reminder.occurrence.id}:${reminder.recipient.id}`;
    if (handled.has(key)) continue;
    handled.add(key);
    // All missed reminders of this Occurrence and recipient, also those outside this batch.
    const group = await deps.queue.missed(reminder.occurrence.id, reminder.recipient.id, now, STALE_AFTER_MS);
    const latest = group.at(-1);
    if (latest === undefined) continue;
    const covered = group.slice(0, -1).map((entry) => entry.reminderId);
    const normalSoon = await deps.queue.hasNormalReminder(reminder.occurrence.id, reminder.recipient.id, now, STALE_AFTER_MS, CATCH_UP_QUIET_MS);
    if (normalSoon) covered.push(latest.reminderId);
    if (covered.length > 0) {
      await deps.queue.supersede(covered, now);
      counts.superseded += covered.length;
    }
    if (normalSoon) continue;
    const entry = byRecipient.get(reminder.recipient.id) ?? { recipient: reminder.recipient, reminderIds: [] };
    entry.reminderIds.push(latest.reminderId);
    byRecipient.set(reminder.recipient.id, entry);
  }
  for (const { recipient, reminderIds } of byRecipient.values()) {
    // Group on every enabled channel first, then send: a reminder is only finished when all its channels are.
    const created: string[] = [];
    for (const notifier of deps.notifiers) {
      if (!(await notifier.enabledFor(recipient))) continue;
      const summaryId = await deps.queue.groupIntoSummary(recipient.id, notifier.channel, reminderIds, now, DELIVERY_LEASE_MS);
      if (summaryId !== null) created.push(summaryId);
    }
    for (const summaryId of created) await sendSummary(deps, summaryId, { status: 'claimed', deliveryId: summaryId, attempt: 1 }, now, counts);
    // No channel on: nothing is sent; the reminders are done.
    for (const reminderId of reminderIds) await deps.queue.settleDelivered(reminderId, now);
  }
}

/**
 * Sends the reminders whose time has come (13.5, 14.1), through every channel the recipient enabled.
 * Every (reminder, channel) is claimed in the database before sending, so a restart or a concurrent
 * worker never sends it again once success was recorded; transient failures are retried a bounded
 * number of times. Delivery never changes Schedules, Occurrences, Runs or their history.
 * Best effort: a crash after a provider accepted a message but before success was recorded can repeat
 * that one message.
 */
export async function dispatchDueReminders(deps: ReminderDeps): Promise<DispatchResult> {
  const counts: Counts = { sent: 0, retried: 0, failed: 0, skipped: 0, superseded: 0, summaries: 0 };
  const now = deps.clock.now();

  // Catch-up summaries waiting for a retry, or whose claim expired.
  for (const summaryId of await deps.queue.dueSummaries(now, SUMMARY_BATCH)) {
    const claim = await deps.queue.claimSummary(summaryId, now, DELIVERY_LEASE_MS);
    if (claim.status === 'claimed') await sendSummary(deps, summaryId, claim, now, counts);
  }

  const missed: DueReminder[] = [];
  for (const reminder of await deps.queue.due(now, REMINDER_BATCH)) {
    if (!mayReceive(reminder)) {
      await deps.queue.settle(reminder.reminderId, [], now);
      counts.skipped++;
      continue;
    }
    if (!reminder.inDelivery && now.getTime() - reminder.remindAt.getTime() > STALE_AFTER_MS) {
      missed.push(reminder);
      continue;
    }
    const channels: ReminderNotifier[] = [];
    for (const notifier of deps.notifiers) {
      if (await notifier.enabledFor(reminder.recipient)) channels.push(notifier);
    }
    const text = textInput(reminder, now, reminderUrl(deps.publicOrigin, reminder.schedule.workspaceId));
    for (const notifier of channels) {
      const claim = await deps.queue.claim(reminder.reminderId, notifier.channel, now, DELIVERY_LEASE_MS);
      if (claim.status !== 'claimed') continue;
      const message: OutgoingNotification = { subject: emailTextsEn.reminder.subject(text), body: emailTextsEn.reminder.body(text), key: messageKey('r', reminder.reminderId, notifier.channel) };
      const sent = await deliver(
        () => notifier.send(reminder.recipient, message),
        claim,
        now,
        {
          sent: () => deps.queue.sent(claim.deliveryId, now),
          retry: (at, code) => deps.queue.retry(claim.deliveryId, now, at, code),
          failed: (code) => deps.queue.failed(claim.deliveryId, now, code),
        },
        counts,
      );
      if (sent) counts.sent++;
    }
    await deps.queue.settle(
      reminder.reminderId,
      channels.map((notifier) => notifier.channel),
      now,
    );
  }

  if (missed.length > 0) await catchUp(deps, missed, now, counts);
  return counts;
}

