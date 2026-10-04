import {
  DomainValidationError,
  MAX_OPEN_SCHEDULES_PER_WORKSPACE,
  addDays,
  daysBetween,
  fixedDatesInRange,
  localDateAt,
  parseLocalDate,
  timelinessAt,
  type LocalDate,
  type LocalTime,
  type Procedure,
  type ProcedureId,
  type RunSummary,
  type Schedule,
  type ScheduleTimeliness,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { TodayFilter } from '../ports/today.ts';
import type { Clock } from '../ports/clock.ts';
import type { InstanceSettingsRepository } from '../ports/instance-settings-repository.ts';
import type { ProcedureActivity, ProcedureActivityRepository } from '../ports/procedure-activity.ts';
import type { ProcedureRepository } from '../ports/procedure-repository.ts';
import type { RunRepository } from '../ports/run-repository.ts';
import type { ScheduleRepository, ScheduledOccurrence } from '../ports/schedule-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { OCCURRENCE_LIST_LIMIT } from '../schedules/use-cases.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface HomeDeps {
  readonly workspaces: WorkspaceRepository;
  readonly procedures: ProcedureRepository;
  readonly activity: ProcedureActivityRepository;
  readonly schedules: ScheduleRepository;
  readonly runs: RunRepository;
  readonly settings: InstanceSettingsRepository;
  readonly clock: Clock;
}

/** Active executions shown on Home. */
export const HOME_ACTIVE_LIMIT = 50;
const NO_ACTIVITY: ProcedureActivity = Object.freeze({ lastCompletedAt: null, active: [] });

/** Pins are personal (13.12): not Workspace history, never audited; anyone who can see the Procedure may pin it. */
export async function pinProcedure(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId }): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const pinned = await deps.activity.pin({ userId: input.actor.id, workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now() });
  if (!pinned) throw new ProcedureNotFoundError();
}

export async function unpinProcedure(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId }): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  if (!(await deps.activity.unpin(input.actor.id, input.workspaceId, input.procedureId))) throw new ProcedureNotFoundError();
}

export interface ProcedureCard {
  readonly procedure: Procedure;
  readonly pinned: boolean;
  readonly activity: ProcedureActivity;
  /** The earliest open Occurrence of a Schedule of this Procedure, if any. */
  readonly nextOccurrence: ScheduledOccurrence | null;
}

/**
 * The Procedure list as cards (13.10, 13.16): pinned first (in pinning order), then by title; with the
 * last completion, active executions and the next scheduled date.
 */
export async function listProcedureCards(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ProcedureCard[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const [procedures, pinned, activity, schedules] = await Promise.all([
    deps.procedures.listActive(input.workspaceId),
    deps.activity.pinnedIds(input.actor.id, input.workspaceId),
    deps.activity.activity(input.workspaceId),
    deps.schedules.listOpen(input.workspaceId, OCCURRENCE_LIST_LIMIT),
  ]);
  const pinOrder = new Map(pinned.map((id, index) => [id, index]));
  const next = new Map<string, ScheduledOccurrence>();
  for (const item of schedules) {
    const procedureId = item.schedule.procedureId;
    if (procedureId !== null && item.occurrence.state === 'OPEN' && !next.has(procedureId)) next.set(procedureId, item);
  }
  return procedures
    .map((procedure) => ({
      procedure,
      pinned: pinOrder.has(procedure.id),
      activity: activity.get(procedure.id) ?? NO_ACTIVITY,
      nextOccurrence: next.get(procedure.id) ?? null,
    }))
    .sort((a, b) => {
      const pa = pinOrder.get(a.procedure.id) ?? Number.POSITIVE_INFINITY;
      const pb = pinOrder.get(b.procedure.id) ?? Number.POSITIVE_INFINITY;
      return pa !== pb ? pa - pb : a.procedure.title.localeCompare(b.procedure.title, 'en');
    });
}

/** How far ahead Upcoming looks (D16); later Occurrences are reachable through the calendar. */
export const UPCOMING_DAYS = 90;
/** Completed or skipped this recently: shown with who and when. */
export const RECENTLY_DONE_MS = 24 * 60 * 60_000;
export const RECENTLY_DONE_LIMIT = 10;

export type OverviewItem = ScheduledOccurrence & { readonly timeliness: ScheduleTimeliness };

export interface HomeOverview {
  /** Overdue Occurrences, oldest first (several of one Schedule are grouped by the client). */
  readonly overdue: readonly OverviewItem[];
  readonly today: readonly OverviewItem[];
  /** Due within the next 90 days (in each Schedule's zone). */
  readonly upcoming: readonly OverviewItem[];
  /** Open Occurrences further ahead than Upcoming shows. */
  readonly later: number;
  /** Completed or skipped in the last 24 hours, newest first. */
  readonly recentlyDone: readonly ScheduledOccurrence[];
  /** Active Runs not already shown with their Occurrence. */
  readonly active: readonly RunSummary[];
  readonly pinned: readonly ProcedureCard[];
  readonly recent: readonly ProcedureCard[];
  readonly recentLimit: number;
}

/**
 * Workspace Home (13.9, 14.2): what needs attention (Overdue, Today), what is coming (Upcoming), what
 * is going on (Active), what one uses (Pinned, Recent). Each Occurrence is judged by its own Schedule's
 * time zone. One read model with the calendar: the Occurrences of the Schedule repository.
 */
export async function getHome(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly filter?: TodayFilter }): Promise<HomeOverview> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view', null);
  const on = await deps.workspaces.enabledTools(input.workspaceId);
  const proceduresOn = on.includes('PROCEDURES');
  const now = deps.clock.now();
  const { recentProceduresLimit } = await deps.settings.get();
  const [cards, open, recentlyDone, active, recentIds] = await Promise.all([
    proceduresOn ? listProcedureCards(deps, input) : Promise.resolve([]),
    deps.schedules.listOpen(input.workspaceId, OCCURRENCE_LIST_LIMIT),
    deps.schedules.listRecentlyClosed(input.workspaceId, new Date(now.getTime() - RECENTLY_DONE_MS), RECENTLY_DONE_LIMIT),
    proceduresOn ? deps.runs.list(input.workspaceId, { state: 'ACTIVE', limit: HOME_ACTIVE_LIMIT }) : Promise.resolve({ items: [] }),
    proceduresOn ? deps.activity.recentIds(input.actor.id, input.workspaceId, recentProceduresLimit) : Promise.resolve([]),
  ]);
  const overdue: OverviewItem[] = [];
  const today: OverviewItem[] = [];
  const upcoming: OverviewItem[] = [];
  let later = 0;
  const shown = (item: ScheduledOccurrence) => input.filter === undefined || input.filter === 'ALL' || (input.filter === 'MINE' ? (item.occurrence.assignee ?? item.schedule.assignee)?.userId === input.actor.id : (item.occurrence.assignee ?? item.schedule.assignee) === null);
  for (const item of open.filter(shown)) {
    const timeliness = timelinessAt({ dueDate: item.occurrence.dueDate, timeZone: item.schedule.timeZone }, now);
    if (timeliness === 'OVERDUE') overdue.push({ ...item, timeliness });
    else if (timeliness === 'TODAY') today.push({ ...item, timeliness });
    else if (item.occurrence.dueDate <= addDays(localDateAt(now, item.schedule.timeZone), UPCOMING_DAYS)) upcoming.push({ ...item, timeliness });
    else later++;
  }
  const shownRuns = new Set(open.flatMap((item) => (item.occurrence.run === null ? [] : [item.occurrence.run.id as string])));
  const byId = new Map(cards.map((card) => [card.procedure.id as string, card]));
  return {
    overdue,
    today,
    upcoming,
    later,
    recentlyDone: recentlyDone.filter(shown),
    active: (input.filter === 'MINE' ? [] : active.items).filter((summary) => !shownRuns.has(summary.run.id)),
    pinned: cards.filter((card) => card.pinned),
    recent: recentIds.flatMap((id) => byId.get(id) ?? []),
    recentLimit: recentProceduresLimit,
  };
}

/** The widest range one calendar request may ask for (a month grid shows six weeks). */
export const CALENDAR_MAX_DAYS = 92;
/** Entries (stored and projected together) returned per request; beyond it the answer is marked truncated. */
export const CALENDAR_ENTRY_LIMIT = 2000;

/** A future date of an active fixed series that has no Occurrence yet: shown, not actionable. */
export interface ProjectedOccurrence {
  readonly schedule: Schedule;
  readonly dueDate: LocalDate;
  readonly time: LocalTime | null;
}

export interface CalendarRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
  /** Stored Occurrences due in the range (open, in progress, completed, skipped), earliest first. */
  readonly occurrences: readonly ScheduledOccurrence[];
  /** Dates the generator will create Occurrences for, earliest first. */
  readonly projected: readonly ProjectedOccurrence[];
  /** More entries exist in the range than are returned. */
  readonly truncated: boolean;
}

/**
 * The calendar's read model (14.4): the Occurrences due from `from` to `to` — the same rows Home shows —
 * plus the projected dates of active fixed series. Completion-based series are not projected (their next
 * date depends on when the current one is done). Read-only; the range is only what is displayed and never
 * limits scheduling (D16).
 */
export async function occurrencesInRange(
  deps: HomeDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly from: string; readonly to: string },
): Promise<CalendarRange> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view', 'CALENDAR');
  const from = parseLocalDate(input.from);
  const to = parseLocalDate(input.to);
  const days = daysBetween(from, to);
  if (days < 0 || days >= CALENDAR_MAX_DAYS) throw new DomainValidationError('to', 'invalid_range', `The range must be 1 to ${CALENDAR_MAX_DAYS} days`);
  const [stored, series] = await Promise.all([
    deps.schedules.listDueBetween(input.workspaceId, from, to, CALENDAR_ENTRY_LIMIT + 1),
    deps.schedules.listFixedSeries(input.workspaceId, MAX_OPEN_SCHEDULES_PER_WORKSPACE),
  ]);
  const occurrences = stored.slice(0, CALENDAR_ENTRY_LIMIT);
  let truncated = stored.length > CALENDAR_ENTRY_LIMIT;
  const projected: ProjectedOccurrence[] = [];
  for (const { schedule, latestDueDate } of series) {
    if (schedule.recurrence.kind !== 'FIXED') continue;
    for (const dueDate of fixedDatesInRange(schedule.recurrence, schedule.anchorDate, latestDueDate ?? undefined, from, to)) {
      projected.push({ schedule, dueDate, time: schedule.time });
    }
  }
  projected.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : (a.time ?? '').localeCompare(b.time ?? '')));
  const room = CALENDAR_ENTRY_LIMIT - occurrences.length;
  if (projected.length > room) truncated = true;
  return { from, to, occurrences, projected: projected.slice(0, room), truncated };
}
