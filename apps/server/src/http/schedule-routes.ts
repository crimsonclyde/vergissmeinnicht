import {
  cancelSchedule,
  getSchedule,
  listOpenSchedules,
  rescheduleProcedure,
  scheduleProcedure,
  startScheduledProcedure,
} from '@vergissmeinnicht/application';
import { REMINDER_UNITS, UUID_V4, type ProcedureId, type ScheduledProcedure, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { detailView } from './run-routes.ts';
import { requireUser, type Principal } from './session.ts';

const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const scheduleParams = z.strictObject({ workspaceId: uuid, scheduleId: uuid });
// Coarse transport bounds; the domain validates calendar dates, times, zones and reminder limits.
const timing = {
  date: z.string().max(10),
  time: z.string().max(5).nullable().optional(),
  timeZone: z.string().max(64),
  reminderTime: z.string().max(5).optional(),
  reminders: z.array(z.strictObject({ unit: z.enum(REMINDER_UNITS), amount: z.number().int().min(0).max(1000) })).max(10),
};
const createBody = z.strictObject({ procedureId: uuid, ...timing });
const updateBody = z.strictObject({ expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ...timing });
const cancelBody = z.strictObject({ expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Display names only: internal user ids are not needed by clients. */
export function scheduleView(schedule: ScheduledProcedure) {
  return {
    id: schedule.id,
    procedureId: schedule.procedureId,
    procedure: schedule.procedure,
    date: schedule.date,
    time: schedule.time,
    timeZone: schedule.timeZone,
    reminderTime: schedule.reminderTime,
    reminders: schedule.reminders,
    state: schedule.state,
    revision: schedule.revision,
    createdAt: schedule.createdAt.toISOString(),
    createdBy: schedule.createdBy.displayName,
    runId: schedule.runId,
    closed: schedule.closed === null ? null : { at: schedule.closed.at.toISOString(), by: schedule.closed.by.displayName },
  };
}

/**
 * Scheduled Procedures of one Workspace (`/api/workspaces/{workspaceId}/schedules`, 13.4). Every
 * route requires a session; membership, capabilities and Workspace scoping are enforced in the use-cases.
 */
export async function scheduleRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.schedules;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const items = await listOpenSchedules(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { schedules: items.map(scheduleView) };
  });

  app.post('/', { bodyLimit: 4096 }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createBody, request.body);
    const schedule = await scheduleProcedure(deps, {
      ...body,
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: body.procedureId as ProcedureId,
    });
    return reply.code(201).send({ schedule: scheduleView(schedule) });
  });

  app.get('/:scheduleId', async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    return { schedule: scheduleView(await getSchedule(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scheduleId })) };
  });

  app.post('/:scheduleId/update', { bodyLimit: 4096 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const body = parse(updateBody, request.body);
    const schedule = await rescheduleProcedure(deps, { ...body, actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scheduleId });
    return { schedule: scheduleView(schedule) };
  });

  app.post('/:scheduleId/cancel', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const { expectedRevision } = parse(cancelBody, request.body);
    const schedule = await cancelSchedule(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scheduleId, expectedRevision });
    return { schedule: scheduleView(schedule) };
  });

  app.post('/:scheduleId/start', async (request, reply) => {
    const { workspaceId, scheduleId } = parse(scheduleParams, request.params);
    const detail = await startScheduledProcedure(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, scheduleId });
    return reply.code(201).send({ run: detailView(detail) });
  });
}
