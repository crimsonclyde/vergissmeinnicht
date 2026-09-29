import {
  DEFAULT_REMINDER_TIME,
  MAX_OPEN_SCHEDULES_PER_WORKSPACE,
  normalizeReminders,
  parseLocalDate,
  parseLocalTime,
  parseScheduledProcedureId,
  parseTimeZone,
  upcomingReminders,
  validateScheduleDate,
  type ProcedureId,
  type ReminderOffset,
  type RunDetail,
  type ScheduledProcedure,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { NotificationPreferencesRepository, ScheduleRepository, ScheduleTimingInput, ScheduleWriteResult } from '../ports/schedule-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { startRun, type RunDeps } from '../runs/use-cases.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ScheduleClosedError, ScheduleConflictError, ScheduleLimitReachedError, ScheduleNotFoundError, ScheduledProcedureUnavailableError } from './errors.ts';

export interface ScheduleDeps {
  readonly workspaces: WorkspaceRepository;
  readonly schedules: ScheduleRepository;
  readonly notificationPreferences: NotificationPreferencesRepository;
  readonly clock: Clock;
}

/** Open items listed per Workspace (Home shows Due and Upcoming from this list). */
export const SCHEDULE_LIST_LIMIT = 500;

/** Timing as the client sends it; validated here, never trusted. */
export interface ScheduleTimingRequest {
  readonly date: string;
  readonly time?: string | null | undefined;
  readonly timeZone: string;
  /** Defaults to the actor's default reminder time. */
  readonly reminderTime?: string | undefined;
  readonly reminders: readonly ReminderOffset[];
}

async function timingFrom(deps: ScheduleDeps, actor: User, request: ScheduleTimingRequest): Promise<ScheduleTimingInput> {
  const timeZone = parseTimeZone(request.timeZone);
  const date = parseLocalDate(request.date);
  validateScheduleDate(date, timeZone, deps.clock.now());
  const time = request.time === undefined || request.time === null ? null : parseLocalTime(request.time);
  const reminderTime = parseLocalTime(
    request.reminderTime ?? (await deps.notificationPreferences.find(actor.id))?.reminderTime ?? DEFAULT_REMINDER_TIME,
    'reminderTime',
  );
  const reminders = normalizeReminders(request.reminders);
  const upcoming = upcomingReminders({ date, time, timeZone, reminderTime, reminders }, deps.clock.now());
  return { date, time, timeZone, reminderTime, reminders, upcoming };
}

function unwrap(result: ScheduleWriteResult): ScheduledProcedure {
  switch (result.status) {
    case 'ok':
      return result.schedule;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ScheduleNotFoundError();
    case 'procedure_not_found':
      throw new ProcedureNotFoundError();
    case 'conflict':
      throw new ScheduleConflictError();
    case 'closed':
      throw new ScheduleClosedError();
    case 'limit_reached':
      throw new ScheduleLimitReachedError();
  }
}

const mayManage = { actorMay: (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, 'schedule.manage') };

/**
 * Schedules a Procedure of the Workspace for a date (13.4). Only the intention is stored — no Run is
 * created, now or when the date arrives. Reminders go to the actor.
 */
export async function scheduleProcedure(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId } & ScheduleTimingRequest,
): Promise<ScheduledProcedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const timing = await timingFrom(deps, input.actor, input);
  return unwrap(
    await deps.schedules.create(
      { ...timing, workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now(), maxOpen: MAX_OPEN_SCHEDULES_PER_WORKSPACE },
      userActor(input.actor),
      mayManage,
    ),
  );
}

/** Moves an open item to another date/time or changes its reminders. */
export async function rescheduleProcedure(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string; readonly expectedRevision: number } & ScheduleTimingRequest,
): Promise<ScheduledProcedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const scheduleId = parseScheduledProcedureId(input.scheduleId);
  const timing = await timingFrom(deps, input.actor, input);
  return unwrap(
    await deps.schedules.reschedule(
      { ...timing, workspaceId: input.workspaceId, scheduleId, expectedRevision: input.expectedRevision, at: deps.clock.now() },
      userActor(input.actor),
      mayManage,
    ),
  );
}

export async function cancelSchedule(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string; readonly expectedRevision: number },
): Promise<ScheduledProcedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const scheduleId = parseScheduledProcedureId(input.scheduleId);
  return unwrap(
    await deps.schedules.cancel(
      { workspaceId: input.workspaceId, scheduleId, expectedRevision: input.expectedRevision, at: deps.clock.now() },
      userActor(input.actor),
      mayManage,
    ),
  );
}

/** Open items of the Workspace (anyone who can see its Procedures). */
export async function listOpenSchedules(deps: ScheduleDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ScheduledProcedure[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.schedules.listOpen(input.workspaceId, SCHEDULE_LIST_LIMIT);
}

export async function getSchedule(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string },
): Promise<ScheduledProcedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const schedule = await deps.schedules.find(input.workspaceId, parseScheduledProcedureId(input.scheduleId));
  if (schedule === undefined) throw new ScheduleNotFoundError();
  return schedule;
}

/**
 * The user presses Start on a scheduled item: a normal Run is created from the Procedure's
 * definition *now*, and the item is closed as STARTED — in the same transaction. A deleted source
 * Procedure is never started silently.
 */
export async function startScheduledProcedure(
  deps: ScheduleDeps & RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string },
): Promise<RunDetail> {
  const schedule = await getSchedule(deps, input);
  if (schedule.state !== 'SCHEDULED') throw new ScheduleClosedError();
  if (schedule.procedure.deleted) throw new ScheduledProcedureUnavailableError();
  return startRun(deps, { actor: input.actor, workspaceId: input.workspaceId, procedureId: schedule.procedureId, fromSchedule: schedule.id });
}
