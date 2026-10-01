import type {
  Actor,
  LocalDate,
  LocalTime,
  Occurrence,
  OccurrenceId,
  ProcedureId,
  Recurrence,
  ReminderOffset,
  RunId,
  RunSummary,
  Schedule,
  ScheduleId,
  ScheduleKind,
  TimeZoneName,
  UserId,
  WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** The editable part of a Schedule, already validated and normalized by the use-case. */
export interface ScheduleContentInput {
  /** REMINDER only. */
  readonly title: string | null;
  readonly description: string;
  readonly recurrence: Recurrence;
  readonly anchorDate: LocalDate;
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
  readonly reminders: readonly ReminderOffset[];
  readonly assigneeUserId: UserId | null;
}

/** An Occurrence together with its Schedule (what lists and actions return). */
export interface ScheduledOccurrence {
  readonly schedule: Schedule;
  readonly occurrence: Occurrence;
}

export type ScheduleWriteStatus =
  | 'forbidden'
  | 'not_found'
  | 'procedure_not_found'
  | 'conflict'
  | 'closed'
  | 'limit_reached'
  | 'invalid_assignee'
  /** The action does not apply to this kind (e.g. Complete on a Procedure Occurrence). */
  | 'wrong_kind'
  /** Reopen refused: the next Occurrence of a completion-based series was already acted on. */
  | 'next_in_use'
  /** Another Occurrence of the Schedule is already due on that date. */
  | 'date_taken'
  | 'paused'
  | 'run_not_eligible';

export type ScheduleWriteResult = { readonly status: 'ok'; readonly schedule: Schedule } | { readonly status: ScheduleWriteStatus };
export type OccurrenceWriteResult = { readonly status: 'ok'; readonly item: ScheduledOccurrence } | { readonly status: ScheduleWriteStatus };

export interface OccurrenceHistoryEntry extends ScheduledOccurrence {
  /** Runs linked now or before (aborted or unlinked ones included), newest first. */
  readonly runs: readonly { readonly runId: RunId; readonly how: 'STARTED' | 'LINKED'; readonly linkedAt: Date; readonly linkedBy: string; readonly ended: 'ABORTED' | 'UNLINKED' | null }[];
}

/**
 * Schedules and Occurrences (14.1), always addressed by Workspace id *and* object id. Every write runs
 * in one IMMEDIATE transaction that re-checks the guard, keeps reminders in step (per Occurrence and
 * recipient) and records its audit event. `at` is the time of the change; "today" is judged in each
 * Schedule's own zone.
 */
export interface ScheduleRepository {
  create(
    input: ScheduleContentInput & {
      readonly workspaceId: WorkspaceId;
      readonly kind: ScheduleKind;
      readonly procedureId: ProcedureId | null;
      readonly at: Date;
      readonly maxOpen: number;
    },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ScheduleWriteResult>;
  /** Changes apply to Occurrences not yet acted on; history is never rewritten. */
  update(
    input: ScheduleContentInput & { readonly workspaceId: WorkspaceId; readonly scheduleId: ScheduleId; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ScheduleWriteResult>;
  pause(input: ScheduleRef & { readonly expectedRevision: number }, actor: UserActor, guard: ActorGuard): Promise<ScheduleWriteResult>;
  /** Fixed series: creates the Occurrences that fell into the pause and skips them when `skipElapsed`. */
  resume(input: ScheduleRef & { readonly expectedRevision: number; readonly skipElapsed: boolean }, actor: UserActor, guard: ActorGuard): Promise<ScheduleWriteResult>;
  /** Cancels the OPEN Occurrences; history stays. */
  end(input: ScheduleRef & { readonly expectedRevision: number }, actor: UserActor, guard: ActorGuard): Promise<ScheduleWriteResult>;
  /** Skips every OPEN Occurrence of the Schedule due before `before` (never IN_PROGRESS ones). */
  skipOlder(input: ScheduleRef & { readonly before: LocalDate; readonly reason: string | null }, actor: UserActor, guard: ActorGuard): Promise<{ readonly status: 'ok'; readonly skipped: number } | { readonly status: ScheduleWriteStatus }>;

  complete(input: OccurrenceRef, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  reopen(input: OccurrenceRef, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  skip(input: OccurrenceRef & { readonly reason: string | null }, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  move(input: OccurrenceRef & { readonly dueDate: LocalDate; readonly time: LocalTime | null }, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  assign(input: OccurrenceRef & { readonly assigneeUserId: UserId | null }, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  /** Deliberately links an eligible existing Run (D7); a completed Run completes the Occurrence. */
  linkRun(input: OccurrenceRef & { readonly runId: RunId }, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;
  /** Ends the current link; the Occurrence is OPEN again. */
  unlinkRun(input: OccurrenceRef, actor: UserActor, guard: ActorGuard): Promise<OccurrenceWriteResult>;

  findSchedule(workspaceId: WorkspaceId, scheduleId: ScheduleId): Promise<Schedule | undefined>;
  findOccurrence(workspaceId: WorkspaceId, occurrenceId: OccurrenceId): Promise<ScheduledOccurrence | undefined>;
  /** Active and paused Schedules of the Workspace, at most `limit`. */
  listSchedules(workspaceId: WorkspaceId, limit: number): Promise<Schedule[]>;
  /** A Schedule's Occurrences, newest first, with their Run links. */
  history(workspaceId: WorkspaceId, scheduleId: ScheduleId, limit: number): Promise<OccurrenceHistoryEntry[]>;
  /** OPEN and IN_PROGRESS Occurrences of the Workspace, earliest due first. */
  listOpen(workspaceId: WorkspaceId, limit: number): Promise<ScheduledOccurrence[]>;
  /** Occurrences completed or skipped since `since`, newest first. */
  listRecentlyClosed(workspaceId: WorkspaceId, since: Date, limit: number): Promise<ScheduledOccurrence[]>;
  /** Occurrences due from `from` to `to` (inclusive; CANCELLED ones left out), earliest first, at most `limit`. */
  listDueBetween(workspaceId: WorkspaceId, from: LocalDate, to: LocalDate, limit: number): Promise<ScheduledOccurrence[]>;
  /**
   * Active fixed series the generator continues (not paused or ended, Procedure not deleted), each with
   * the due date of its latest Occurrence — where the generator goes on from.
   */
  listFixedSeries(workspaceId: WorkspaceId, limit: number): Promise<{ readonly schedule: Schedule; readonly latestDueDate: LocalDate | null }[]>;
  /** Runs that may be linked to the Occurrence (D7): same Procedure, active or completed, not linked, started since the previous due date. */
  linkableRuns(workspaceId: WorkspaceId, occurrenceId: OccurrenceId): Promise<RunSummary[]>;
  /**
   * The generator (system, not audited): creates the next Occurrence of active fixed series whose
   * latest due date has passed — idempotent by (Schedule, due date). At most `limit` Occurrences.
   */
  advance(now: Date, limit: number): Promise<number>;
}

export interface ScheduleRef {
  readonly workspaceId: WorkspaceId;
  readonly scheduleId: ScheduleId;
  readonly at: Date;
}

export interface OccurrenceRef {
  readonly workspaceId: WorkspaceId;
  readonly occurrenceId: OccurrenceId;
  readonly at: Date;
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
