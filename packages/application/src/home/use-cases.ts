import { timelinessAt, type Procedure, type ProcedureId, type RunSummary, type ScheduledProcedure, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { InstanceSettingsRepository } from '../ports/instance-settings-repository.ts';
import type { ProcedureActivity, ProcedureActivityRepository } from '../ports/procedure-activity.ts';
import type { ProcedureRepository } from '../ports/procedure-repository.ts';
import type { RunRepository } from '../ports/run-repository.ts';
import type { ScheduleRepository } from '../ports/schedule-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { SCHEDULE_LIST_LIMIT } from '../schedules/use-cases.ts';
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
  /** The earliest open scheduled item of this Procedure, if any. */
  readonly nextSchedule: ScheduledProcedure | null;
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
    deps.schedules.listOpen(input.workspaceId, SCHEDULE_LIST_LIMIT),
  ]);
  const pinOrder = new Map(pinned.map((id, index) => [id, index]));
  const next = new Map<string, ScheduledProcedure>();
  for (const schedule of schedules) if (!next.has(schedule.procedureId)) next.set(schedule.procedureId, schedule);
  return procedures
    .map((procedure) => ({
      procedure,
      pinned: pinOrder.has(procedure.id),
      activity: activity.get(procedure.id) ?? NO_ACTIVITY,
      nextSchedule: next.get(procedure.id) ?? null,
    }))
    .sort((a, b) => {
      const pa = pinOrder.get(a.procedure.id) ?? Number.POSITIVE_INFINITY;
      const pb = pinOrder.get(b.procedure.id) ?? Number.POSITIVE_INFINITY;
      return pa !== pb ? pa - pb : a.procedure.title.localeCompare(b.procedure.title, 'en');
    });
}

export interface HomeOverview {
  /** Overdue and today, earliest first. */
  readonly due: readonly (ScheduledProcedure & { readonly timeliness: 'OVERDUE' | 'TODAY' })[];
  readonly upcoming: readonly ScheduledProcedure[];
  readonly active: readonly RunSummary[];
  readonly pinned: readonly ProcedureCard[];
  readonly recent: readonly ProcedureCard[];
  readonly recentLimit: number;
}

/**
 * Workspace Home (13.9, 13.11): what to do (Due), what is coming (Upcoming), what is going on
 * (Active), what one uses (Pinned, Recent). Due is judged by each item's own time zone.
 */
export async function getHome(deps: HomeDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<HomeOverview> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const now = deps.clock.now();
  const { recentProceduresLimit } = await deps.settings.get();
  const [cards, schedules, active, recentIds] = await Promise.all([
    listProcedureCards(deps, input),
    deps.schedules.listOpen(input.workspaceId, SCHEDULE_LIST_LIMIT),
    deps.runs.list(input.workspaceId, { state: 'ACTIVE', limit: HOME_ACTIVE_LIMIT }),
    deps.activity.recentIds(input.actor.id, input.workspaceId, recentProceduresLimit),
  ]);
  const due: (ScheduledProcedure & { timeliness: 'OVERDUE' | 'TODAY' })[] = [];
  const upcoming: ScheduledProcedure[] = [];
  for (const schedule of schedules) {
    const timeliness = timelinessAt(schedule, now);
    if (timeliness === 'UPCOMING') upcoming.push(schedule);
    else due.push({ ...schedule, timeliness });
  }
  const byId = new Map(cards.map((card) => [card.procedure.id as string, card]));
  return {
    due,
    upcoming,
    active: active.items,
    pinned: cards.filter((card) => card.pinned),
    recent: recentIds.flatMap((id) => byId.get(id) ?? []),
    recentLimit: recentProceduresLimit,
  };
}
