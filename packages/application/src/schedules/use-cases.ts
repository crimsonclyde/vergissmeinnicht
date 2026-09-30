import {
  MAX_OPEN_SCHEDULES_PER_WORKSPACE,
  localDateAt,
  normalizeReminderDescription,
  normalizeReminderTitle,
  normalizeReminders,
  normalizeSkipReason,
  parseLocalDate,
  parseLocalTime,
  parseOccurrenceId,
  parseRecurrence,
  parseScheduleId,
  parseTimeZone,
  validateScheduleDate,
  type ProcedureId,
  type ReminderOffset,
  type RunDetail,
  type RunId,
  type RunSummary,
  type Schedule,
  type ScheduleKind,
  type User,
  type UserId,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  NotificationPreferencesRepository,
  OccurrenceHistoryEntry,
  OccurrenceWriteResult,
  ScheduleContentInput,
  ScheduleRepository,
  ScheduleWriteResult,
  ScheduleWriteStatus,
  ScheduledOccurrence,
} from '../ports/schedule-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { startRun, type RunDeps } from '../runs/use-cases.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import {
  InvalidAssigneeError,
  NextOccurrenceInUseError,
  OccurrenceDateTakenError,
  RunNotEligibleError,
  ScheduleClosedError,
  ScheduleConflictError,
  ScheduleLimitReachedError,
  ScheduleNotFoundError,
  ScheduledProcedureUnavailableError,
  WrongScheduleKindError,
} from './errors.ts';

export interface ScheduleDeps {
  readonly workspaces: WorkspaceRepository;
  readonly schedules: ScheduleRepository;
  readonly notificationPreferences: NotificationPreferencesRepository;
  readonly clock: Clock;
}

/** Schedules listed per Workspace. */
export const SCHEDULE_LIST_LIMIT = 500;
/** Open Occurrences read for Home and the Procedure cards. */
export const OCCURRENCE_LIST_LIMIT = 1000;
/** Occurrences shown in a Schedule's history. */
export const OCCURRENCE_HISTORY_LIMIT = 200;

/** A recurrence rule as the client sends it; validated in the domain. */
export interface RecurrenceRequest {
  readonly kind: string;
  readonly unit?: string | undefined;
  readonly interval?: number | undefined;
  readonly weekdays?: readonly number[] | null | undefined;
  readonly lastDayOfMonth?: boolean | undefined;
}

/** What the client sends to create or change a Schedule; everything is validated here, never trusted. */
export interface ScheduleRequest {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  /** Default: one-time. */
  readonly recurrence?: RecurrenceRequest | undefined;
  /** The first due date (fixed recurrence counts from it). */
  readonly date: string;
  readonly time?: string | null | undefined;
  readonly timeZone: string;
  readonly reminders: readonly ReminderOffset[];
  /** Omitted: unchanged (update) / shared (create). */
  readonly assigneeUserId?: string | null | undefined;
}

const guardFor = (capability: WorkspaceCapability) => ({ actorMay: (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, capability) });

function fail(status: ScheduleWriteStatus): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ScheduleNotFoundError();
    case 'procedure_not_found':
      throw new ProcedureNotFoundError();
    case 'conflict':
      throw new ScheduleConflictError();
    case 'closed':
    case 'paused':
      throw new ScheduleClosedError();
    case 'limit_reached':
      throw new ScheduleLimitReachedError();
    case 'invalid_assignee':
      throw new InvalidAssigneeError();
    case 'wrong_kind':
      throw new WrongScheduleKindError();
    case 'next_in_use':
      throw new NextOccurrenceInUseError();
    case 'date_taken':
      throw new OccurrenceDateTakenError();
    case 'run_not_eligible':
      throw new RunNotEligibleError();
  }
}

const schedule = (result: ScheduleWriteResult): Schedule => (result.status === 'ok' ? result.schedule : fail(result.status));
const occurrence = (result: OccurrenceWriteResult): ScheduledOccurrence => (result.status === 'ok' ? result.item : fail(result.status));

function contentFrom(kind: ScheduleKind, request: ScheduleRequest, current: Schedule | undefined, now: Date): ScheduleContentInput {
  const timeZone = parseTimeZone(request.timeZone);
  const anchorDate = parseLocalDate(request.date);
  // A new first date must be today or later; an unchanged one may lie in the past (a running series).
  if (current === undefined || current.anchorDate !== anchorDate || current.timeZone !== timeZone) validateScheduleDate(anchorDate, timeZone, now);
  const recurrence = request.recurrence === undefined ? (current?.recurrence ?? { kind: 'ONCE' as const }) : parseRecurrence(request.recurrence);
  return {
    title: kind === 'REMINDER' ? normalizeReminderTitle(request.title ?? current?.title ?? '') : null,
    description: kind === 'REMINDER' ? normalizeReminderDescription(request.description ?? current?.description ?? '') : '',
    recurrence,
    anchorDate,
    time: request.time === undefined || request.time === null ? null : parseLocalTime(request.time),
    timeZone,
    reminders: normalizeReminders(request.reminders),
    assigneeUserId: (request.assigneeUserId === undefined ? (current?.assignee?.userId ?? null) : request.assigneeUserId) as UserId | null,
  };
}

/**
 * Creates a standalone Reminder or schedules a Procedure (14.1). Only the intention is stored — no Run
 * is created, now or when a date arrives. Reminders go to the Assignee, else to the creator.
 */
export async function createSchedule(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly kind?: ScheduleKind | undefined; readonly procedureId?: string | undefined } & ScheduleRequest,
): Promise<Schedule> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const kind: ScheduleKind = input.kind ?? (input.procedureId === undefined ? 'REMINDER' : 'PROCEDURE');
  if (kind === 'PROCEDURE' && input.procedureId === undefined) throw new ProcedureNotFoundError();
  const content = contentFrom(kind, input, undefined, deps.clock.now());
  return schedule(
    await deps.schedules.create(
      {
        ...content,
        workspaceId: input.workspaceId,
        kind,
        procedureId: kind === 'PROCEDURE' ? (input.procedureId as ProcedureId) : null,
        at: deps.clock.now(),
        maxOpen: MAX_OPEN_SCHEDULES_PER_WORKSPACE,
      },
      userActor(input.actor),
      guardFor('schedule.manage'),
    ),
  );
}

/** Changes a Schedule; applies to Occurrences not yet acted on — history is never rewritten. */
export async function updateSchedule(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string; readonly expectedRevision: number } & ScheduleRequest,
): Promise<Schedule> {
  const current = await getSchedule(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const content = contentFrom(current.kind, input, current, deps.clock.now());
  return schedule(
    await deps.schedules.update(
      { ...content, workspaceId: input.workspaceId, scheduleId: current.id, expectedRevision: input.expectedRevision, at: deps.clock.now() },
      userActor(input.actor),
      guardFor('schedule.manage'),
    ),
  );
}

type ScheduleCommand = { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string; readonly expectedRevision: number };

export async function pauseSchedule(deps: ScheduleDeps, input: ScheduleCommand): Promise<Schedule> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const scheduleId = parseScheduleId(input.scheduleId);
  return schedule(
    await deps.schedules.pause({ workspaceId: input.workspaceId, scheduleId, expectedRevision: input.expectedRevision, at: deps.clock.now() }, userActor(input.actor), guardFor('schedule.manage')),
  );
}

/** Fixed series keep their anchor; Occurrences that fell into the pause are created and skipped when `skipElapsed` (D3). */
export async function resumeSchedule(deps: ScheduleDeps, input: ScheduleCommand & { readonly skipElapsed: boolean }): Promise<Schedule> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const scheduleId = parseScheduleId(input.scheduleId);
  return schedule(
    await deps.schedules.resume(
      { workspaceId: input.workspaceId, scheduleId, expectedRevision: input.expectedRevision, skipElapsed: input.skipElapsed, at: deps.clock.now() },
      userActor(input.actor),
      guardFor('schedule.manage'),
    ),
  );
}

/** Ends a Schedule: its OPEN Occurrences are cancelled, history stays. */
export async function endSchedule(deps: ScheduleDeps, input: ScheduleCommand): Promise<Schedule> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const scheduleId = parseScheduleId(input.scheduleId);
  return schedule(
    await deps.schedules.end({ workspaceId: input.workspaceId, scheduleId, expectedRevision: input.expectedRevision, at: deps.clock.now() }, userActor(input.actor), guardFor('schedule.manage')),
  );
}

/** Bulk skip (D1): every OPEN Occurrence of the Schedule due before `before`. */
export async function skipOlderOccurrences(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string; readonly before: string; readonly reason?: string | undefined },
): Promise<number> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'schedule.manage');
  const result = await deps.schedules.skipOlder(
    { workspaceId: input.workspaceId, scheduleId: parseScheduleId(input.scheduleId), before: parseLocalDate(input.before), reason: normalizeSkipReason(input.reason), at: deps.clock.now() },
    userActor(input.actor),
    guardFor('schedule.manage'),
  );
  return result.status === 'ok' ? result.skipped : fail(result.status);
}

type OccurrenceCommand = { readonly actor: User; readonly workspaceId: WorkspaceId; readonly occurrenceId: string };

async function occurrenceCommand<T>(
  deps: ScheduleDeps,
  input: OccurrenceCommand,
  capability: WorkspaceCapability,
  run: (ref: { workspaceId: WorkspaceId; occurrenceId: ReturnType<typeof parseOccurrenceId>; at: Date }, guard: ReturnType<typeof guardFor>) => Promise<T>,
): Promise<T> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, capability);
  return run({ workspaceId: input.workspaceId, occurrenceId: parseOccurrenceId(input.occurrenceId), at: deps.clock.now() }, guardFor(capability));
}

/** Completes a Reminder Occurrence (D6: the execution permission); the completing user is recorded separately from the Assignee. */
export async function completeOccurrence(deps: ScheduleDeps, input: OccurrenceCommand): Promise<ScheduledOccurrence> {
  return occurrence(await occurrenceCommand(deps, input, 'run.execute', (ref, guard) => deps.schedules.complete(ref, userActor(input.actor), guard)));
}

/** Undo of Complete or Skip; a completion-based series withdraws the next Occurrence if nobody acted on it yet. */
export async function reopenOccurrence(deps: ScheduleDeps, input: OccurrenceCommand): Promise<ScheduledOccurrence> {
  return occurrence(await occurrenceCommand(deps, input, 'run.execute', (ref, guard) => deps.schedules.reopen(ref, userActor(input.actor), guard)));
}

/** Skips one Occurrence; completion-based series count the next due date from the skip date (D2). */
export async function skipOccurrence(deps: ScheduleDeps, input: OccurrenceCommand & { readonly reason?: string | undefined }): Promise<ScheduledOccurrence> {
  const reason = normalizeSkipReason(input.reason);
  return occurrence(await occurrenceCommand(deps, input, 'run.execute', (ref, guard) => deps.schedules.skip({ ...ref, reason }, userActor(input.actor), guard)));
}

/** Moves one OPEN Occurrence ("this occurrence only") without changing the rule. */
export async function moveOccurrence(
  deps: ScheduleDeps,
  input: OccurrenceCommand & { readonly date: string; readonly time?: string | null | undefined },
): Promise<ScheduledOccurrence> {
  const current = await getOccurrence(deps, input);
  const dueDate = parseLocalDate(input.date);
  validateScheduleDate(dueDate, current.schedule.timeZone, deps.clock.now());
  const time = input.time === undefined || input.time === null ? null : parseLocalTime(input.time);
  return occurrence(await occurrenceCommand(deps, input, 'schedule.manage', (ref, guard) => deps.schedules.move({ ...ref, dueDate, time }, userActor(input.actor), guard)));
}

/** Assigns one Occurrence (null: back to the Schedule's Assignee). Grants no access. */
export async function assignOccurrence(deps: ScheduleDeps, input: OccurrenceCommand & { readonly assigneeUserId: string | null }): Promise<ScheduledOccurrence> {
  return occurrence(
    await occurrenceCommand(deps, input, 'schedule.manage', (ref, guard) =>
      deps.schedules.assign({ ...ref, assigneeUserId: input.assigneeUserId as UserId | null }, userActor(input.actor), guard),
    ),
  );
}

/** D7: deliberately links an eligible existing Run; a completed Run completes the Occurrence. */
export async function linkRunToOccurrence(deps: ScheduleDeps, input: OccurrenceCommand & { readonly runId: string }): Promise<ScheduledOccurrence> {
  return occurrence(
    await occurrenceCommand(deps, input, 'run.execute', (ref, guard) => deps.schedules.linkRun({ ...ref, runId: input.runId as RunId }, userActor(input.actor), guard)),
  );
}

export async function unlinkRunFromOccurrence(deps: ScheduleDeps, input: OccurrenceCommand): Promise<ScheduledOccurrence> {
  return occurrence(await occurrenceCommand(deps, input, 'run.execute', (ref, guard) => deps.schedules.unlinkRun(ref, userActor(input.actor), guard)));
}

export async function linkableRuns(deps: ScheduleDeps, input: OccurrenceCommand): Promise<RunSummary[]> {
  // An Occurrence of another Workspace is unknown here (404), never an empty list.
  const item = await getOccurrence(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  return deps.schedules.linkableRuns(input.workspaceId, item.occurrence.id);
}

/**
 * Start from an Occurrence: a normal Run is created from the Procedure's definition *now* and linked,
 * the Occurrence becomes IN_PROGRESS — in one transaction. A deleted Procedure is never started silently.
 */
export async function startOccurrence(deps: ScheduleDeps & RunDeps, input: OccurrenceCommand): Promise<RunDetail> {
  const item = await getOccurrence(deps, input);
  if (item.schedule.kind !== 'PROCEDURE' || item.schedule.procedureId === null) throw new WrongScheduleKindError();
  if (item.occurrence.state !== 'OPEN') throw new ScheduleClosedError();
  if (item.schedule.procedure?.deleted !== false) throw new ScheduledProcedureUnavailableError();
  return startRun(deps, { actor: input.actor, workspaceId: input.workspaceId, procedureId: item.schedule.procedureId, fromOccurrence: item.occurrence.id });
}

/** Compatibility with the 13.4 API: Start on a one-time Schedule starts its open Occurrence. */
export async function startSchedule(deps: ScheduleDeps & RunDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string }): Promise<RunDetail> {
  await getSchedule(deps, input);
  const open = (await deps.schedules.history(input.workspaceId, parseScheduleId(input.scheduleId), OCCURRENCE_HISTORY_LIMIT))
    .filter((entry) => entry.occurrence.state === 'OPEN')
    .sort((a, b) => a.occurrence.dueDate.localeCompare(b.occurrence.dueDate))[0];
  if (open === undefined) throw new ScheduleClosedError();
  return startOccurrence(deps, { actor: input.actor, workspaceId: input.workspaceId, occurrenceId: open.occurrence.id });
}

export async function getSchedule(deps: ScheduleDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string }): Promise<Schedule> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const found = await deps.schedules.findSchedule(input.workspaceId, parseScheduleId(input.scheduleId));
  if (found === undefined) throw new ScheduleNotFoundError();
  return found;
}

export async function getOccurrence(deps: ScheduleDeps, input: OccurrenceCommand): Promise<ScheduledOccurrence> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const found = await deps.schedules.findOccurrence(input.workspaceId, parseOccurrenceId(input.occurrenceId));
  if (found === undefined) throw new ScheduleNotFoundError();
  return found;
}

/** Active and paused Schedules of the Workspace (anyone who can see its Procedures). */
export async function listSchedules(deps: ScheduleDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<Schedule[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.schedules.listSchedules(input.workspaceId, SCHEDULE_LIST_LIMIT);
}

/** A Schedule with its Occurrences (newest first) and the Runs linked to them. */
export async function scheduleHistory(
  deps: ScheduleDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly scheduleId: string },
): Promise<{ readonly schedule: Schedule; readonly occurrences: OccurrenceHistoryEntry[] }> {
  const found = await getSchedule(deps, input);
  return { schedule: found, occurrences: await deps.schedules.history(input.workspaceId, found.id, OCCURRENCE_HISTORY_LIMIT) };
}

/** OPEN and IN_PROGRESS Occurrences of the Workspace, earliest due first. */
export async function listOpenOccurrences(deps: ScheduleDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ScheduledOccurrence[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.schedules.listOpen(input.workspaceId, OCCURRENCE_LIST_LIMIT);
}

/** The calendar date "today" of an Occurrence's Schedule (its own zone). */
export function todayFor(item: ScheduledOccurrence, now: Date): string {
  return localDateAt(now, item.schedule.timeZone);
}

/**
 * The generator (steps.md 14.1): creates the next Occurrence of fixed series whose latest due date has
 * passed. Runs in the server's minute job; idempotent, so overlapping runs or restarts do no harm.
 */
export async function advanceSchedules(deps: Pick<ScheduleDeps, 'schedules' | 'clock'>): Promise<number> {
  return deps.schedules.advance(deps.clock.now(), ADVANCE_BATCH);
}

/** Occurrences created per generator run (bounded work per minute). */
export const ADVANCE_BATCH = 500;
