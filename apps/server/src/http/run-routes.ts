import { abortRun, changeStepState, completeRun, getRun, getRunHistory, listRuns, startRun } from '@vergissmeinnicht/application';
import {
  RUN_STATES,
  STEP_STATES,
  UUID_V4,
  type ProcedureId,
  type Run,
  type RunDetail,
  type RunId,
  type RunStep,
  type RunStepId,
  type RunSummary,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { auditEventView, historyQuery } from './history-view.ts';
import { registerRunEvents } from './run-events.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const runParams = z.strictObject({ workspaceId: uuid, runId: uuid });
const listQuery = z.strictObject({ state: z.enum(RUN_STATES).optional(), before: uuid.optional() });
const startBody = z.strictObject({ procedureId: uuid });
const abortBody = z.strictObject({ reason: z.string().max(4096).optional() });
const stepParams = z.strictObject({ workspaceId: uuid, runId: uuid, stepId: uuid });
const stateBody = z.strictObject({
  expectedState: z.enum(STEP_STATES),
  state: z.enum(STEP_STATES),
  reason: z.string().max(4096).optional(),
  /** A change made offline and sent later (8.5). The device time is informational only. */
  offline: z
    .strictObject({ clientChangeId: z.uuid({ version: 'v4' }), deviceTime: z.iso.datetime({ offset: true }).optional() })
    .optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

function runView(run: Run) {
  return {
    id: run.id,
    procedureId: run.procedureId,
    procedureRevision: run.procedureRevision,
    title: run.title,
    description: run.description,
    icon: run.icon,
    tags: run.tags,
    state: run.state,
    revision: run.revision,
    startedAt: run.startedAt.toISOString(),
    // Display-name snapshot only; the internal user id is not needed by clients.
    startedBy: run.startedBy.displayName,
    ended: run.ended === null ? null : { at: run.ended.at.toISOString(), by: run.ended.by.displayName, reason: run.ended.reason },
  };
}

function stepView(step: RunStep) {
  const { stateChange, ...rest } = step;
  return {
    ...rest,
    // Display-name snapshot and time only; internal user ids are not needed by clients.
    stateChange:
      stateChange === null
        ? null
        : {
            by: stateChange.by.displayName,
            at: stateChange.at.toISOString(),
            reason: stateChange.reason,
            deviceAt: stateChange.deviceAt === null ? null : stateChange.deviceAt.toISOString(),
          },
  };
}

const summaryView = (summary: RunSummary) => ({ ...runView(summary.run), stepCounts: summary.stepCounts });
const detailView = (detail: RunDetail) => ({
  ...runView(detail.run),
  sections: detail.sections.map((section) => ({ ...section, steps: section.steps.map(stepView) })),
});

/**
 * Runs of one Workspace (`/api/workspaces/{workspaceId}/runs`). Every route requires a session;
 * membership, capabilities and Workspace scoping of ids are enforced in the use-cases.
 */
export async function runRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.runs;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { state, before } = parse(listQuery, request.query);
    const page = await listRuns(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, state, before });
    return { runs: page.items.map(summaryView), nextCursor: page.nextCursor };
  });

  app.post('/', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { procedureId } = parse(startBody, request.body);
    const detail = await startRun(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return reply.code(201).send({ run: detailView(detail) });
  });

  app.post('/:runId/steps/:stepId/state', { bodyLimit: 16 * 1024 }, async (request) => {
    const { workspaceId, runId, stepId } = parse(stepParams, request.params);
    const body = parse(stateBody, request.body);
    const result = await changeStepState(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      runId: runId as RunId,
      stepId: stepId as RunStepId,
      expectedState: body.expectedState,
      to: body.state,
      reason: body.reason,
      offline:
        body.offline === undefined
          ? undefined
          : {
              clientChangeId: body.offline.clientChangeId,
              deviceAt: body.offline.deviceTime === undefined ? undefined : new Date(body.offline.deviceTime),
            },
    });
    return { step: stepView(result.step), runRevision: result.runRevision, duplicate: result.duplicate };
  });

  app.post('/:runId/complete', async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const detail = await completeRun(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, runId: runId as RunId });
    return { run: detailView(detail) };
  });

  app.post('/:runId/abort', { bodyLimit: 16 * 1024 }, async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const { reason } = parse(abortBody, request.body ?? {});
    const detail = await abortRun(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      runId: runId as RunId,
      reason,
    });
    return { run: detailView(detail) };
  });

  registerRunEvents(
    app,
    services,
    services.runChanges,
    (request) => {
      const { workspaceId, runId } = parse(runParams, request.params);
      return { workspaceId: workspaceId as WorkspaceId, runId: runId as RunId, principal: principalOf(request) };
    },
    services.runEvents,
  );

  app.get('/:runId/history', async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const { after } = parse(historyQuery, request.query);
    const page = await getRunHistory(services.history, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      runId: runId as RunId,
      after,
    });
    return { events: page.items.map(auditEventView), nextCursor: page.nextCursor };
  });

  app.get('/:runId', async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const detail = await getRun(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, runId: runId as RunId });
    return { run: detailView(detail) };
  });
}
