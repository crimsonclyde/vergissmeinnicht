import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getGazetteWeather, removeGazetteWatchItem, getGazetteHeaderSettings, saveGazetteHeaderSettings, addGazetteHeaderImage, removeGazetteHeaderImage, readGazetteHeaderImage, overrideGazetteHeader, importGazetteWatchItems, createGazetteWatchItem, deleteGazetteDraft, gazetteDashboard, listGazetteWatchItems, recordGazettePrices, updateGazetteWatchItem, getGazetteEdition, getGazetteEditionById, getGazetteSettings, listGazetteEditions, publishGazetteDraft, saveGazetteSettings, writeGazetteEdition,
} from '@vergissmeinnicht/application';
import { MAX_IMAGE_UPLOAD_BYTES, UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
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
 * The Daily Planet (43). Reads need `gazette.view`; writing and publishing editions `gazette.publish`;
 * settings `gazette.manage`. Every write is validated in the domain before it is stored; a refused
 * payload changes nothing.
 */
export async function gazetteRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  const deps = services.gazette;

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_UPLOAD_BYTES }, (_request, body, done) => done(null, body));
  app.get('/header', async request => {
    const { actor, workspaceId } = context(request);
    return getGazetteHeaderSettings(deps, actor, workspaceId);
  });
  app.post('/header', { bodyLimit: 8192 }, async request => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ settings: z.unknown(), expectedRevision: revision }), request.body);
    return saveGazetteHeaderSettings(deps, actor, workspaceId, input.settings, input.expectedRevision);
  });
  app.post('/header/images', {
    bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
    config: { rateLimit: { max: 20, timeWindow: 900_000, hook: 'preHandler', keyGenerator: request => `gazette-header:${request.principal?.user.id ?? request.ip}` } },
  }, async request => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ replace: uuid.optional(), revision: z.coerce.number().int().min(0).max(1_000_000_000) }), request.query);
    if (!Buffer.isBuffer(request.body)) throw new InvalidRequestError();
    return addGazetteHeaderImage(deps, actor, workspaceId, request.body, input.replace ?? null, input.revision);
  });
  app.get('/header/images/:imageId', async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const { imageId } = parse(z.object({ imageId: uuid }), request.params);
    const bytes = await readGazetteHeaderImage(deps, actor, workspaceId, imageId);
    return reply.type('image/jpeg').header('Content-Disposition', 'inline; filename="gazette-header.jpg"').header('Cache-Control', 'private, no-store').send(Buffer.from(bytes));
  });
  app.post('/header/images/:imageId/delete', { bodyLimit: 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const { imageId } = parse(z.object({ imageId: uuid }), request.params);
    const { expectedRevision } = parse(z.strictObject({ expectedRevision: revision }), request.body);
    return removeGazetteHeaderImage(deps, actor, workspaceId, imageId, expectedRevision);
  });
  app.post('/header/override', { bodyLimit: 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const { date, imageId, expectedRevision } = parse(z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), imageId: uuid.nullable(), expectedRevision: revision }), request.body);
    await overrideGazetteHeader(deps, actor, workspaceId, date, imageId, expectedRevision);
    return reply.code(204).send();
  });

  app.get('/today', async request => {
    const { actor, workspaceId } = context(request);
    return gazetteDashboard(deps, actor, workspaceId);
  });
  // 43.7: the forecast VMN would put into today's (or tomorrow's) edition, for the page and its settings.
  app.get('/weather', {
    config: { rateLimit: { max: 30, timeWindow: 600_000, hook: 'preHandler', keyGenerator: request => `gazette-weather:${request.principal?.user.id ?? request.ip}` } },
  }, async request => {
    const { actor, workspaceId } = context(request);
    const { date } = parse(z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), request.query);
    return getGazetteWeather(deps, actor, workspaceId, date);
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
  app.post('/watchlist/import', { bodyLimit: 128 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const input = parse(z.strictObject({ items: z.unknown() }), request.body);
    return importGazetteWatchItems(deps, actor, workspaceId, input.items);
  });
  app.post('/watchlist/:itemId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request);
    const { itemId } = parse(z.object({ itemId: uuid }), request.params);
    const { expectedRevision } = parse(z.strictObject({ expectedRevision: revision }), request.body);
    await removeGazetteWatchItem(deps, actor, workspaceId, itemId, expectedRevision);
    return reply.code(204).send();
  });
  app.post('/watchlist/:itemId', { bodyLimit: 16 * 1024 }, async request => {
    const { actor, workspaceId } = context(request);
    const { itemId } = parse(z.object({ itemId: uuid }), request.params);
    const input = parse(z.strictObject({ item: z.unknown(), expectedRevision: revision }), request.body);
    return { item: await updateGazetteWatchItem(deps, actor, workspaceId, itemId, input.item, input.expectedRevision) };
  });
}
