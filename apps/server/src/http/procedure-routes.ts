import {
  createProcedure,
  deleteProcedure,
  getProcedure,
  listProcedures,
  updateProcedure,
} from '@vergissmeinnicht/application';
import { UUID_V4, type Procedure, type ProcedureId, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const procedureParams = z.strictObject({ workspaceId: uuid, procedureId: uuid });
// Coarse transport bounds; the domain applies the exact rules (code points, characters, icon keys).
const content = {
  title: z.string().max(512),
  description: z.string().max(16_384).default(''),
  icon: z.string().max(64),
  tags: z.array(z.string().max(128)).max(50).default([]),
};
const createBody = z.strictObject(content);
const updateBody = z.strictObject({ ...content, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

function procedureView(procedure: Procedure) {
  return {
    id: procedure.id,
    title: procedure.title,
    description: procedure.description,
    icon: procedure.icon,
    tags: procedure.tags,
    revision: procedure.revision,
    createdAt: procedure.createdAt.toISOString(),
    updatedAt: procedure.updatedAt.toISOString(),
  };
}

/**
 * Procedures of one Workspace (`/api/workspaces/{workspaceId}/procedures`). Every route requires a
 * session; membership, capabilities and Workspace scoping of the Procedure id are enforced in the use-cases.
 */
export async function procedureRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.procedures;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const procedures = await listProcedures(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { procedures: procedures.map(procedureView) };
  });

  app.post('/', async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createBody, request.body);
    const procedure = await createProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      content: body,
    });
    return reply.code(201).send({ procedure: procedureView(procedure) });
  });

  app.get('/:procedureId', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const procedure = await getProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return { procedure: procedureView(procedure) };
  });

  app.post('/:procedureId/update', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const { expectedRevision, ...body } = parse(updateBody, request.body);
    const procedure = await updateProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
      expectedRevision,
      content: body,
    });
    return { procedure: procedureView(procedure) };
  });

  app.post('/:procedureId/delete', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    await deleteProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return reply.code(204).send();
  });
}
