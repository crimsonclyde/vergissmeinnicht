import type { LocalDate, LocalTime, OccurrenceState, ScheduleKind, ScheduleState, TimeZoneName, User, WorkspaceRole } from '@vergissmeinnicht/domain';

/** Channels a reminder can travel through (13.6, 13.7). Future: ntfy, Gotify, webhook — same port. */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'TELEGRAM'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A reminder whose time has come, with what is needed to decide whether and what to send. */
export interface DueReminder {
  readonly reminderId: string;
  readonly reminderKey: string;
  readonly remindAt: Date;
  readonly occurrence: {
    readonly id: string;
    readonly state: OccurrenceState;
    readonly dueDate: LocalDate;
    readonly time: LocalTime | null;
    readonly assigneeUserId: string | null;
  };
  readonly schedule: {
    readonly id: string;
    readonly kind: ScheduleKind;
    readonly state: ScheduleState;
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly title: string;
    readonly procedureDeleted: boolean;
    readonly timeZone: TimeZoneName;
    readonly assigneeUserId: string | null;
    readonly createdByUserId: string;
  };
  readonly recipient: User;
  /** The recipient's current role in the Workspace; null when no longer a member. */
  readonly recipientRole: WorkspaceRole | null;
  /** A delivery of this reminder is already under way (a retry): it continues normally, never as catch-up. */
  readonly inDelivery: boolean;
}

/** Result of claiming one (reminder, channel) delivery — or one summary — before sending. */
export type DeliveryClaim =
  | { readonly status: 'claimed'; readonly deliveryId: string; readonly attempt: number }
  /** Already sent, failed for good or skipped: never again. */
  | { readonly status: 'final' }
  /** Another worker holds it, or its retry is not due yet. */
  | { readonly status: 'busy' };

/** A catch-up summary with its members (for sending or re-sending after a retry). */
export interface CatchUpSummary {
  readonly summaryId: string;
  readonly channel: NotificationChannel;
  readonly recipient: User;
  readonly members: readonly (DueReminder & { readonly deliveryId: string })[];
}

/**
 * Durable reminder state. Every logical notification — (Occurrence, recipient, offset instant,
 * channel), or a catch-up summary — is a persistent record claimed atomically in the database *before*
 * anything is sent, so restarts or concurrent workers never send it twice after success was recorded; a
 * claim held longer than the lease counts as interrupted and may be retried (bounded attempts).
 */
export interface ReminderQueue {
  /** Canonical source, state and role immediately before sending; absent while source tool is off. */
  current(reminderId: string): Promise<DueReminder | undefined>;
  /** Unprocessed, not cancelled reminders due at `now` (not waiting for a retry, not in a summary), oldest first. */
  due(now: Date, limit: number): Promise<DueReminder[]>;
  claim(reminderId: string, channel: NotificationChannel, now: Date, leaseMs: number): Promise<DeliveryClaim>;
  sent(deliveryId: string, now: Date): Promise<void>;
  retry(deliveryId: string, now: Date, nextAttemptAt: Date, errorCode: string): Promise<void>;
  failed(deliveryId: string, now: Date, errorCode: string): Promise<void>;
  skipped(deliveryId: string, now: Date, reason: string): Promise<void>;
  /**
   * Marks the reminder processed when every channel in `channels` has a final delivery (or when
   * `channels` is empty); otherwise remembers the earliest pending retry so it is not looked at before.
   */
  settle(reminderId: string, channels: readonly NotificationChannel[], now: Date): Promise<void>;

  // ---- Outage catch-up (D5)
  /** Unprocessed, not cancelled reminders of the Occurrence and recipient that are more than `staleMs` late, oldest first. */
  missed(occurrenceId: string, recipientUserId: string, now: Date, staleMs: number): Promise<{ readonly reminderId: string; readonly remindAt: Date }[]>;
  /** Another reminder of the same Occurrence and recipient is deliverable now or within `windowMs` (at most `staleMs` late). */
  hasNormalReminder(occurrenceId: string, recipientUserId: string, now: Date, staleMs: number, windowMs: number): Promise<boolean>;
  /** Missed reminders covered by a later catch-up: processed without being sent. */
  supersede(reminderIds: readonly string[], now: Date): Promise<void>;
  /**
   * Atomically creates one claimed summary (attempt 1) for the recipient and channel and adds the given
   * reminders that have no delivery on this channel yet (as GROUPED deliveries). Null when none was added.
   */
  groupIntoSummary(recipientUserId: string, channel: NotificationChannel, reminderIds: readonly string[], now: Date, leaseMs: number): Promise<string | null>;
  /** Summaries whose retry is due or whose claim expired. */
  dueSummaries(now: Date, limit: number): Promise<string[]>;
  claimSummary(summaryId: string, now: Date, leaseMs: number): Promise<DeliveryClaim>;
  summary(summaryId: string): Promise<CatchUpSummary | undefined>;
  /** A member no longer eligible (re-checked at send time): its delivery is SKIPPED and it leaves the summary. */
  dropFromSummary(deliveryIds: readonly string[], now: Date, reason: string): Promise<void>;
  summarySent(summaryId: string, now: Date): Promise<void>;
  summaryRetry(summaryId: string, now: Date, nextAttemptAt: Date, errorCode: string): Promise<void>;
  summaryFailed(summaryId: string, now: Date, errorCode: string): Promise<void>;
  summarySkipped(summaryId: string, now: Date, reason: string): Promise<void>;
  /** Marks the reminder processed once all its deliveries are final. */
  settleDelivered(reminderId: string, now: Date): Promise<void>;
}

/** A rendered notification. `key` is stable per logical notification (e.g. for an email Message-ID). */
export interface OutgoingNotification {
  readonly subject: string;
  readonly body: string;
  readonly key: string;
}

/**
 * One notification provider (email, Telegram, …). Providers never decide *whether* a person may
 * receive a reminder — the dispatcher does (membership, capability, state) before asking them.
 */
export interface ReminderNotifier {
  readonly channel: NotificationChannel;
  /** The provider is enabled on this server and the person has it switched on (and connected). */
  enabledFor(user: User): Promise<boolean>;
  send(user: User, message: OutgoingNotification): Promise<void>;
}

/**
 * Delivery failed. `code` is a stable reason (never a provider response, address or token);
 * `transient` failures are retried a bounded number of times.
 */
export class NotificationDeliveryError extends Error {
  readonly code: string;
  readonly transient: boolean;

  constructor(code: string, transient: boolean) {
    super('Notification delivery failed');
    this.name = 'NotificationDeliveryError';
    this.code = code;
    this.transient = transient;
  }
}
