import { aiAssistantsAllowed, setAiAssistants } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });
const noQuery = z.strictObject({});
const switchBody = z.strictObject({ allowed: z.boolean() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/**
 * "AI assistants allowed" for one Workspace (45.11): every member may read it, Workspace admins
 * (`workspace.settings.manage`) switch it. Off: no MCP connection reaches the Workspace.
 */
export async function aiAssistantsRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.aiAssistants;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { allowed: await aiAssistantsAllowed(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId }) };
  });

  app.post('/', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    const body = parse(switchBody, request.body);
    return { allowed: await setAiAssistants(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, allowed: body.allowed }) };
  });
}
