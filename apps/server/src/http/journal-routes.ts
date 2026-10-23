import { getJournalEntry, listJournal, saveJournalEntry, authorizeTool, NotAuthorizedError } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';
const uuid = z.string().regex(UUID_V4);
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new InvalidRequestError(); return result.data; }
const actor = (request: FastifyRequest) => { if (request.principal === null) throw new Error('Missing principal'); return request.principal.user; };

/** Bundled modules have explicit routes, session/CSRF protection and application-owned authorization. */
export async function journalRoutes(app: FastifyInstance, { services, shared }: { services: AppServices; shared: boolean }) {
  app.addHook('preHandler', requireUser(services));
  function scope(request: FastifyRequest) {
    const params = parse(shared ? z.strictObject({ workspaceId: uuid, entryId: uuid.optional() }) : z.strictObject({ entryId: uuid.optional() }), request.params);
    return 'workspaceId' in params ? params.workspaceId as WorkspaceId : undefined;
  }
  app.get('/', async (request) => {
    const query = parse(z.strictObject({ q: z.string().max(120).default(''), archived: z.enum(['true', 'false']).default('false'), offset: z.coerce.number().int().min(0).max(10000).default(0) }), request.query);
    return listJournal(services.journal, actor(request), scope(request), query.q, query.archived === 'true', query.offset);
  });
  app.get('/:entryId', async (request) => {
    const { entryId } = parse(z.object({ entryId: uuid }), request.params);
    return { entry: await getJournalEntry(services.journal, actor(request), scope(request), entryId) };
  });
  const body = z.strictObject({ content: z.unknown(), expectedRevision: z.number().int().min(0).max(1_000_000_000), archived: z.boolean() });
  app.post('/', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const input = parse(body, request.body);
    const entry = await saveJournalEntry(services.journal, actor(request), scope(request), input.content, undefined, input.expectedRevision, input.archived);
    return reply.code(201).send({ entry });
  });
  app.post('/:entryId', { bodyLimit: 256 * 1024 }, async (request) => {
    const { entryId } = parse(z.object({ entryId: uuid }), request.params);
    const input = parse(body, request.body);
    return { entry: await saveJournalEntry(services.journal, actor(request), scope(request), input.content, entryId, input.expectedRevision, input.archived) };
  });
}

/** Moon metadata is returned only through the active Workspace/tool boundary, independent of Weather. */
export async function moonRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  app.get('/', async (request) => {
    const { workspaceId } = parse(z.strictObject({ workspaceId: uuid }), request.params);
    const id = workspaceId as WorkspaceId;
    await authorizeTool(services.documents, actor(request), id, 'MOON', 'workspace.view');
    const workspace = await services.workspaces.workspaces.findById(id);
    const current = await services.workspaces.users.findById(actor(request).id);
    if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
    await authorizeTool(services.documents, current, id, 'MOON', 'workspace.view');
    return { location: workspace?.location ?? null };
  });
}
