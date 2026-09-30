import { addDays, localDateAt, timelinessAt, type Procedure, type ProcedureId, type RunSummary, type ScheduleTimeliness, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
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
export async function getHome(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<HomeOverview> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const now = deps.clock.now();
  const { recentProceduresLimit } = await deps.settings.get();
  const [cards, open, recentlyDone, active, recentIds] = await Promise.all([
    listProcedureCards(deps, input),
    deps.schedules.listOpen(input.workspaceId, OCCURRENCE_LIST_LIMIT),
    deps.schedules.listRecentlyClosed(input.workspaceId, new Date(now.getTime() - RECENTLY_DONE_MS), RECENTLY_DONE_LIMIT),
    deps.runs.list(input.workspaceId, { state: 'ACTIVE', limit: HOME_ACTIVE_LIMIT }),
    deps.activity.recentIds(input.actor.id, input.workspaceId, recentProceduresLimit),
  ]);
  const overdue: OverviewItem[] = [];
  const today: OverviewItem[] = [];
  const upcoming: OverviewItem[] = [];
  let later = 0;
  for (const item of open) {
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
    recentlyDone,
    active: active.items.filter((summary) => !shownRuns.has(summary.run.id)),
    pinned: cards.filter((card) => card.pinned),
    recent: recentIds.flatMap((id) => byId.get(id) ?? []),
    recentLimit: recentProceduresLimit,
  };
}
