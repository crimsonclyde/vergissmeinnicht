import type {
  Actor,
  LocalDate,
  LocalTime,
  ProcedureId,
  ReminderOffset,
  ScheduledProcedure,
  ScheduledProcedureId,
  TimeZoneName,
  UserId,
  WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

/** When and how: the editable part of a scheduled item (already validated and normalized). */
export interface ScheduleTimingInput {
  readonly date: LocalDate;
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
  readonly reminderTime: LocalTime;
  readonly reminders: readonly ReminderOffset[];
  /** The reminder instants still ahead, from `upcomingReminders` (sent to the item's creator). */
  readonly upcoming: readonly { readonly key: string; readonly at: Date }[];
}

export type ScheduleWriteResult =
  | { readonly status: 'ok'; readonly schedule: ScheduledProcedure }
  | { readonly status: 'forbidden' | 'not_found' | 'procedure_not_found' | 'conflict' | 'closed' | 'limit_reached' };

/**
 * Scheduled Procedures, always addressed by Workspace id *and* item id. Every write runs in one
 * IMMEDIATE transaction that re-checks the guard and records its audit event (SCHEDULE_*).
 */
export interface ScheduleRepository {
  /** Requires a non-deleted Procedure of the Workspace and fewer than `maxOpen` open items. */
  create(
    input: ScheduleTimingInput & { readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date; readonly maxOpen: number },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ScheduleWriteResult>;
  /**
   * Moves an open item (compare-and-set on `expectedRevision`): unsent reminders are cancelled and
   * the new ones stored — a reminder already sent for the same moment is not sent again.
   */
  reschedule(
    input: ScheduleTimingInput & {
      readonly workspaceId: WorkspaceId;
      readonly scheduleId: ScheduledProcedureId;
      readonly expectedRevision: number;
      readonly at: Date;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ScheduleWriteResult>;
  /** Closes an open item as CANCELLED and cancels its unsent reminders. */
  cancel(
    input: { readonly workspaceId: WorkspaceId; readonly scheduleId: ScheduledProcedureId; readonly expectedRevision: number; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ScheduleWriteResult>;
  find(workspaceId: WorkspaceId, scheduleId: ScheduledProcedureId): Promise<ScheduledProcedure | undefined>;
  /** Open (SCHEDULED) items of the Workspace, earliest date first, at most `limit`. */
  listOpen(workspaceId: WorkspaceId, limit: number): Promise<ScheduledProcedure[]>;
}

/** A person's reminder settings (13.8); used for defaults when scheduling. */
export interface NotificationPreferences {
  readonly reminderTime: LocalTime;
  readonly emailReminders: boolean;
  readonly telegramReminders: boolean;
}

export interface NotificationPreferencesRepository {
  find(userId: UserId): Promise<NotificationPreferences | undefined>;
  save(userId: UserId, preferences: NotificationPreferences, at: Date): Promise<void>;
}
