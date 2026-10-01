import {
  assignOccurrence,
  completeOccurrence,
  createSchedule,
  endSchedule,
  getOccurrence,
  linkRunToOccurrence,
  linkableRuns,
  listSchedules,
  moveOccurrence,
  pauseSchedule,
  reopenOccurrence,
  resumeSchedule,
  scheduleHistory,
  skipOccurrence,
  skipOlderOccurrences,
  startOccurrence,
  startSchedule,
  unlinkRunFromOccurrence,
  updateSchedule,
  type OccurrenceHistoryEntry,
  type ProjectedOccurrence,
  type ScheduledOccurrence,
} from '@vergissmeinnicht/application';
import { REMINDER_UNITS, SCHEDULE_KINDS, UUID_V4, responsibleFor, type Schedule, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { detailView, summaryView } from './run-routes.ts';
import { requireUser, type Principal } from './session.ts';

const uuid = z.string().regex(UUID_V4);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const scheduleParams = z.strictObject({ workspaceId: uuid, scheduleId: uuid });
const occurrenceParams = z.strictObject({ workspaceId: uuid, occurrenceId: uuid });
// Coarse transport bounds; the domain validates titles, dates, times, zones, rules and reminder limits.
const recurrence = z.strictObject({
  kind: z.string().max(20),
  unit: z.string().max(10).optional(),
  interval: z.number().int().min(0).max(1000).optional(),
  weekdays: z.array(z.number().int().min(0).max(10)).max(7).nullable().optional(),
  lastDayOfMonth: z.boolean().optional(),
});
const content = {
  title: z.string().max(400).optional(),
  description: z.string().max(8000).optional(),
  recurrence: recurrence.optional(),
  date: z.string().max(10),
  time: z.string().max(5).nullable().optional(),
  timeZone: z.string().max(64),
  /** Accepted for compatibility with 13.4 clients; reminders use the recipient's own reminder time. */
  reminderTime: z.string().max(5).optional(),
  reminders: z.array(z.strictObject({ unit: z.enum(REMINDER_UNITS), amount: z.number().int().min(0).max(1000) })).max(10),
  assigneeUserId: uuid.nullable().optional(),
};
const createBody = z.strictObject({ kind: z.enum(SCHEDULE_KINDS).optional(), procedureId: uuid.optional(), ...content });
const updateBody = z.strictObject({ expectedRevision: revision, ...content });
const revisionBody = z.strictObject({ expectedRevision: revision });
const resumeBody = z.strictObject({ expectedRevision: revision, skipElapsed: z.boolean() });
const skipOlderBody = z.strictObject({ before: z.string().max(10), reason: z.string().max(1000).optional() });
const skipBody = z.strictObject({ reason: z.string().max(1000).optional() });
const moveBody = z.strictObject({ date: z.string().max(10), time: z.string().max(5).nullable().optional() });
const assignBody = z.strictObject({ assigneeUserId: uuid.nullable() });
const linkBody = z.strictObject({ runId: uuid });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

/** `reminderTime` is accepted from 13.4 clients but not used: reminders follow the recipient's own time. */
function withoutReminderTime<T extends { reminderTime?: string | undefined }>(body: T): Omit<T, 'reminderTime'> {
  const copy: Partial<T> = { ...body };
  delete copy.reminderTime;
  return copy as Omit<T, 'reminderTime'>;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

const person = (ref: { userId: string; displayName: string } | null) => (ref === null ? null : { id: ref.userId, name: ref.displayName });

/**
 * Display names only for actors; the Assignee's user id is included because members pick Assignees
 * and filter "assigned to me" (member ids are visible to Workspace members anyway).
 */
export function scheduleView(schedule: Schedule) {
  return {
    id: schedule.id,
    kind: schedule.kind,
    procedureId: schedule.procedureId,
    procedure: schedule.procedure,
    title: schedule.title,
    description: schedule.description,
    recurrence: schedule.recurrence,
    date: schedule.anchorDate,
    time: schedule.time,
    timeZone: schedule.timeZone,
    reminders: schedule.reminders,
    assignee: person(schedule.assignee),
    state: schedule.state,
    pausedAt: schedule.pausedAt?.toISOString() ?? null,
    ended: schedule.ended === null ? null : { at: schedule.ended.at.toISOString(), by: schedule.ended.by.displayName },
    revision: schedule.revision,
    createdAt: schedule.createdAt.toISOString(),
    createdBy: schedule.createdBy.displayName,
  };
}

export function occurrenceView(item: ScheduledOccurrence) {
  const { occurrence } = item;
  return {
    id: occurrence.id,
    schedule: scheduleView(item.schedule),
    dueDate: occurrence.dueDate,
    time: occurrence.time,
    state: occurrence.state,
    /** This Occurrence's own Assignee (override), and who is responsible after falling back to the Schedule's. */
    assignee: person(occurrence.assignee),
    responsible: person(responsibleFor(item.schedule, occurrence)),
    closed: occurrence.closed === null ? null : { at: occurrence.closed.at.toISOString(), by: occurrence.closed.by.displayName },
    skipReason: occurrence.skipReason,
    run: occurrence.run === null ? null : { id: occurrence.run.id, state: occurrence.run.state, startedAt: occurrence.run.startedAt.toISOString(), startedBy: occurrence.run.startedBy },
    revision: occurrence.revision,
  };
}

/** A projected date of a series (14.4): no id, no state — nothing can be done with it until its Occurrence exists. */
export function projectedView(item: ProjectedOccurrence) {
  return { schedule: scheduleView(item.schedule), dueDate: item.dueDate, time: item.time, responsible: person(item.schedule.assignee) };
}

function historyView(entry: OccurrenceHistoryEntry) {
  return {
    ...occurrenceView(entry),
    runs: entry.runs.map((link) => ({ runId: link.runId, how: link.how, linkedAt: link.linkedAt.toISOString(), linkedBy: link.linkedBy, ended: link.ended })),
  };
}

/**
 * Schedules of one Workspace (`/api/workspaces/{workspaceId}/schedules`, 13.4, 14.1). Every route
 * requires a session; membership, capabilities and Workspace scoping are enforced in the use-cases.
 * The 13.4 request shapes keep working (one-time by default; `/cancel` ends; `/start` starts the open Occurrence).
 */
export async function scheduleRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.schedules;
  app.addHook('preHandler', requireUser(services));
  const actorOf = (request: FastifyRequest) => principalOf(request).user;

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { schedules: (await listSchedules(deps, { actor: actorOf(request), workspaceId: workspaceId as WorkspaceId })).map(scheduleView) };
  });

  app.post('/', { bodyLimit: 16_384 }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = withoutReminderTime(parse(createBody, request.body));
    const schedule = await createSchedule(deps, { ...body, actor: actorOf(request), workspaceId: workspaceId as WorkspaceId });
    return reply.code(201).send({ schedule: scheduleView(schedule) });
  });

  app.get('/:scheduleId', async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const { schedule, occurrences } = await scheduleHistory(deps, { actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId });
    return { schedule: scheduleView(schedule), occurrences: occurrences.map(historyView) };
  });

  app.post('/:scheduleId/update', { bodyLimit: 16_384 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const body = withoutReminderTime(parse(updateBody, request.body));
    return { schedule: scheduleView(await updateSchedule(deps, { ...body, actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId })) };
  });

  app.post('/:scheduleId/pause', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const { expectedRevision } = parse(revisionBody, request.body);
    return { schedule: scheduleView(await pauseSchedule(deps, { actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId, expectedRevision })) };
  });

  app.post('/:scheduleId/resume', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const body = parse(resumeBody, request.body);
    return { schedule: scheduleView(await resumeSchedule(deps, { ...body, actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId })) };
  });

  for (const path of ['/:scheduleId/end', '/:scheduleId/cancel']) {
    app.post(path, { bodyLimit: 1024 }, async (request) => {
      const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
      const { expectedRevision } = parse(revisionBody, request.body);
      return { schedule: scheduleView(await endSchedule(deps, { actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId, expectedRevision })) };
    });
  }

  app.post('/:scheduleId/skip-older', { bodyLimit: 2048 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const body = parse(skipOlderBody, request.body);
    return { skipped: await skipOlderOccurrences(deps, { ...body, actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId }) };
  });

  app.post('/:scheduleId/start', async (request, reply) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const detail = await startSchedule(deps, { actor: actorOf(request), workspaceId: workspaceId as WorkspaceId, scheduleId });
    return reply.code(201).send({ run: detailView(detail) });
  });
}

/** Occurrences of one Workspace (`/api/workspaces/{workspaceId}/occurrences`, 14.1). */
export async function occurrenceRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.schedules;
  app.addHook('preHandler', requireUser(services));
  const command = (request: FastifyRequest) => {
    const { workspaceId, occurrenceId } = parse(occurrenceParams, request.params);
    return { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, occurrenceId };
  };

  app.get('/:occurrenceId', async (request) => ({ occurrence: occurrenceView(await getOccurrence(deps, command(request))) }));

  app.post('/:occurrenceId/complete', { bodyLimit: 1024 }, async (request) => ({ occurrence: occurrenceView(await completeOccurrence(deps, command(request))) }));
  app.post('/:occurrenceId/reopen', { bodyLimit: 1024 }, async (request) => ({ occurrence: occurrenceView(await reopenOccurrence(deps, command(request))) }));
  app.post('/:occurrenceId/skip', { bodyLimit: 2048 }, async (request) => {
    const body = parse(skipBody, request.body ?? {});
    return { occurrence: occurrenceView(await skipOccurrence(deps, { ...command(request), ...body })) };
  });
  app.post('/:occurrenceId/move', { bodyLimit: 1024 }, async (request) => {
    const body = parse(moveBody, request.body);
    return { occurrence: occurrenceView(await moveOccurrence(deps, { ...command(request), ...body })) };
  });
  app.post('/:occurrenceId/assign', { bodyLimit: 1024 }, async (request) => {
    const body = parse(assignBody, request.body);
    return { occurrence: occurrenceView(await assignOccurrence(deps, { ...command(request), ...body })) };
  });
  app.post('/:occurrenceId/start', async (request, reply) => reply.code(201).send({ run: detailView(await startOccurrence(deps, command(request))) }));
  app.get('/:occurrenceId/linkable-runs', async (request) => ({ runs: (await linkableRuns(deps, command(request))).map(summaryView) }));
  app.post('/:occurrenceId/link-run', { bodyLimit: 1024 }, async (request) => {
    const body = parse(linkBody, request.body);
    return { occurrence: occurrenceView(await linkRunToOccurrence(deps, { ...command(request), ...body })) };
  });
  app.post('/:occurrenceId/unlink-run', { bodyLimit: 1024 }, async (request) => ({ occurrence: occurrenceView(await unlinkRunFromOccurrence(deps, command(request))) }));
}
