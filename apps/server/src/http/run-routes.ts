import { getRun, listRuns, startRun } from '@vergissmeinnicht/application';
import {
  RUN_STATES,
  UUID_V4,
  type ProcedureId,
  type Run,
  type RunDetail,
  type RunId,
  type RunSummary,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const runParams = z.strictObject({ workspaceId: uuid, runId: uuid });
const listQuery = z.strictObject({ state: z.enum(RUN_STATES).optional() });
const startBody = z.strictObject({ procedureId: uuid });

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
    startedAt: run.startedAt.toISOString(),
    // Display-name snapshot only; the internal user id is not needed by clients.
    startedBy: run.startedBy.displayName,
  };
}

const summaryView = (summary: RunSummary) => ({ ...runView(summary.run), stepCounts: summary.stepCounts });
const detailView = (detail: RunDetail) => ({ ...runView(detail.run), sections: detail.sections });

/**
 * Runs of one Workspace (`/api/workspaces/{workspaceId}/runs`). Every route requires a session;
 * membership, capabilities and Workspace scoping of ids are enforced in the use-cases.
 */
export async function runRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.runs;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { state } = parse(listQuery, request.query);
    const runs = await listRuns(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, state });
    return { runs: runs.map(summaryView) };
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

  app.get('/:runId', async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const detail = await getRun(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, runId: runId as RunId });
    return { run: detailView(detail) };
  });
}
