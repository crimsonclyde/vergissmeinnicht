import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createGazetteWatchItem, deleteGazetteDraft, gazetteDashboard, listGazetteWatchItems, recordGazettePrices, updateGazetteWatchItem, getGazetteEdition, getGazetteEditionById, getGazetteSettings, listGazetteEditions, publishGazetteDraft, saveGazetteSettings, writeGazetteEdition,
} from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppServices } from '../composition.ts';
import { requireUser } from './session.ts';
import { InvalidRequestError } from './errors.ts';

const uuid = z.string().regex(UUID_V4);
const revision = z.number().int().min(0).max(1_000_000_000);
/** Operation ids are chosen by the importing client: a UUID or another opaque, bounded token. */
const operationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/);
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new InvalidRequestError(); return result.data; }
function context(request: FastifyRequest) {
  const { workspaceId } = parse(z.object({ workspaceId: uuid }), request.params);
  if (!request.principal) throw new Error('Missing principal');
  return { actor: request.principal.user, workspaceId: workspaceId as WorkspaceId };
}

/**
 * Morning Gazette (43). Reads need `gazette.view`; writing and publishing editions `gazette.publish`;
 * settings `gazette.manage`. Every write is validated in the domain before it is stored; a refused
 * payload changes nothing.
 */
export async function gazetteRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  const deps = services.gazette;

  app.get('/today', async request => {
    const { actor, workspaceId } = context(request);
    return gazetteDashboard(deps, actor, workspaceId);
  });
  app.get('/settings', async request => {
    const { actor, workspaceId } = context(request);
    return getGazetteSettings(deps, actor, workspaceId);
  });
  app.post('/settings', { bodyLimit: 128 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ settings: z.unknown(), expectedRevision: revision }), request.body);
    return saveGazetteSettings(deps, actor, workspaceId, input.settings, input.expectedRevision);
  });
  app.get('/editions', async request => {
    const { actor, workspaceId } = context(request);
    return listGazetteEditions(deps, actor, workspaceId);
  });
  app.get('/editions/:date', async request => {
    const { actor, workspaceId } = context(request);
    // Checked after authorization (an unknown date is 404 like a missing edition).
    const { date } = parse(z.object({ date: z.string().max(32) }), request.params);
    const { state } = parse(z.strictObject({ state: z.enum(['published', 'draft']).default('published') }), request.query);
    return { edition: await getGazetteEdition(deps, actor, workspaceId, date, state === 'draft' ? 'DRAFT' : 'PUBLISHED') };
  });
  app.get('/editions/id/:editionId', async request => {
    const { actor, workspaceId } = context(request);
    const { editionId } = parse(z.object({ editionId: uuid }), request.params);
    return { edition: await getGazetteEditionById(deps, actor, workspaceId, editionId) };
  });
  /** Create or replace the draft (or, with `publish: true`, the published edition) of the content's date. */
  app.post('/editions', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ operationId: operationId.optional(), content: z.unknown(), publish: z.boolean().default(false), expectedRevision: revision.optional() }), request.body);
    const result = await writeGazetteEdition(deps, actor, workspaceId, { operationId: input.operationId ?? null, content: input.content, publish: input.publish, expectedRevision: input.expectedRevision ?? null });
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });
  app.post('/editions/id/:editionId/publish', { bodyLimit: 4 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const { editionId } = parse(z.object({ editionId: uuid }), request.params);
    const input = parse(z.strictObject({ expectedRevision: revision }), request.body);
    return { edition: await publishGazetteDraft(deps, actor, workspaceId, editionId, input.expectedRevision) };
  });
  // Every state change is a POST in this API (CSRF origin checks cover POST).
  app.post('/editions/id/:editionId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const { editionId } = parse(z.object({ editionId: uuid }), request.params);
    await deleteGazetteDraft(deps, actor, workspaceId, editionId);
    return reply.code(204).send();
  });

  // The persistent watchlist (43.3): kept apart from editions, never removed by retention.
  app.get('/watchlist', async request => {
    const { actor, workspaceId } = context(request);
    return { items: await listGazetteWatchItems(deps, actor, workspaceId) };
  });
  app.post('/watchlist', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ item: z.unknown() }), request.body);
    return reply.code(201).send({ item: await createGazetteWatchItem(deps, actor, workspaceId, input.item) });
  });
  /** Observed prices for one or more items, all or nothing. */
  app.post('/watchlist/prices', { bodyLimit: 64 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ observations: z.unknown() }), request.body);
    return recordGazettePrices(deps, actor, workspaceId, input.observations);
  });
  app.post('/watchlist/:itemId', { bodyLimit: 16 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const { itemId } = parse(z.object({ itemId: uuid }), request.params);
    const input = parse(z.strictObject({ item: z.unknown(), expectedRevision: revision }), request.body);
    return { item: await updateGazetteWatchItem(deps, actor, workspaceId, itemId, input.item, input.expectedRevision) };
  });
}
