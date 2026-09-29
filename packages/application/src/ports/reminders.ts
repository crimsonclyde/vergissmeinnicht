import type { LocalDate, LocalTime, ScheduleState, TimeZoneName, User, WorkspaceRole } from '@vergissmeinnicht/domain';

/** Channels a reminder can travel through (13.6, 13.7). Future: ntfy, Gotify, webhook — same port. */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'TELEGRAM'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A reminder whose time has come, with what is needed to decide whether and what to send. */
export interface DueReminder {
  readonly reminderId: string;
  readonly reminderKey: string;
  readonly remindAt: Date;
  readonly schedule: {
    readonly id: string;
    readonly state: ScheduleState;
    readonly workspaceId: string;
    readonly workspaceName: string;
    readonly procedureTitle: string;
    readonly procedureDeleted: boolean;
    readonly date: LocalDate;
    readonly time: LocalTime | null;
    readonly timeZone: TimeZoneName;
  };
  readonly recipient: User;
  /** The recipient's current role in the Workspace; null when no longer a member. */
  readonly recipientRole: WorkspaceRole | null;
}

/** Result of claiming one (reminder, channel) delivery before sending. */
export type DeliveryClaim =
  | { readonly status: 'claimed'; readonly deliveryId: string; readonly attempt: number }
  /** Already sent, failed for good or skipped: never again. */
  | { readonly status: 'final' }
  /** Another dispatcher holds it, or its retry is not due yet. */
  | { readonly status: 'busy' };

/**
 * Durable reminder state. `claim` is atomic: the (reminder, channel) row is created or taken over in
 * one transaction *before* anything is sent, so restarts or overlapping dispatchers never send twice;
 * a claim held longer than the lease counts as interrupted and may be retried (bounded attempts).
 */
export interface ReminderQueue {
  /** Unprocessed, not cancelled reminders due at `now` (and not waiting for a retry), oldest first. */
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
}

/** What a reminder says. Plain text only; the link opens the Workspace — it never carries a token. */
export interface ReminderMessage {
  readonly procedureTitle: string;
  readonly workspaceName: string;
  readonly date: LocalDate;
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
  /** `DAYS:7`, `HOURS:2`, … */
  readonly reminderKey: string;
  readonly overdue: boolean;
  readonly url: string;
}

/**
 * One notification provider (email, Telegram, …). Providers never decide *whether* a person may
 * receive a reminder — the dispatcher does (membership, capability, state) before asking them.
 */
export interface ReminderNotifier {
  readonly channel: NotificationChannel;
  /** The provider is enabled on this server and the person has it switched on (and connected). */
  enabledFor(user: User): Promise<boolean>;
  send(user: User, message: ReminderMessage): Promise<void>;
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
