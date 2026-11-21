import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  addMapApproach, requireTool, openAttachment, browseMap, changeMapTag, checkedMapBounds, getMapPlace, mapPersonalState, previewMapPlace, recordMapVisit, saveMapPersonalState, saveMapPlace,
} from '@vergissmeinnicht/application';
import { MAP_CATEGORIES, UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppServices } from '../composition.ts';
import { registerAttachmentHttp, sendAttachment } from './attachment-http.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const uuid = z.string().regex(UUID_V4);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const bool = z.enum(['true', 'false']).transform(value => value === 'true').optional();
const bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const searchQuery = z.strictObject({
  search: z.string().max(120).optional(), town: z.string().max(120).optional(), category: z.enum(MAP_CATEGORIES).optional(), tagId: uuid.optional(),
  archived: bool, favorite: bool, want: bool, offset: z.coerce.number().int().min(0).max(100_000).optional(),
  bounds: z.string().max(140).optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}
function context(request: FastifyRequest) {
  const { workspaceId } = parse(z.object({ workspaceId: uuid }), request.params);
  if (!request.principal) throw new Error('Missing principal');
  return { actor: request.principal.user, workspaceId: workspaceId as WorkspaceId };
}
const placeId = (request: FastifyRequest) => parse(z.object({ placeId: uuid }), request.params).placeId;
const write = { bodyLimit: 80_000 };
export async function placesMapRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  const deps = services.placesMap;
  app.addHook('preHandler', async request => {
    const { actor, workspaceId } = context(request);
    await requireTool(deps, actor, workspaceId, 'MAP', 'map.view');
  });
  for (const purpose of ['cover', 'visit'] as const) {
    await app.register(async child => {
      registerAttachmentHttp(child, services.mapAttachments[purpose], request => {
        const ref = context(request);
        return { ...ref, scope: { workspaceId: ref.workspaceId }, authorize: async () => { await requireTool(deps, ref.actor, ref.workspaceId,
          'MAP', purpose === 'cover' ? 'map.edit' : 'map.visit'); } };
      }, { uploadOnly: true });
    }, { prefix: '/' + purpose + '-upload' });
    app.get('/places/:placeId/' + purpose + '-photo/:attachmentId/:kind', async (request, reply) => {
      const ref = context(request);
      await requireTool(deps, ref.actor, ref.workspaceId, 'MAP', purpose === 'cover' ? 'map.view' : 'map.visit');
      const { attachmentId, kind } = parse(z.object({ attachmentId: uuid, kind: z.enum(['preview', 'thumbnail']) }), request.params);
      const record = services.mapMedia[purpose](ref, placeId(request), attachmentId);
      const file = await openAttachment(services.mapAttachments[purpose].store, record, kind);
      return sendAttachment(reply, file.record, file.stream, kind);
    });
  }
  app.get('/places', async request => {
    const { bounds: raw, ...query } = parse(searchQuery, request.query);
    if (raw === undefined) return browseMap(deps, context(request), query);
    const [south, north, west, east] = parse(bounds, raw.split(',').map(part => part.trim() ? Number(part) : NaN));
    return browseMap(deps, context(request), { ...query, bounds: checkedMapBounds({ south, north, west, east }) });
  });
  app.get('/places/:placeId', async request => {
    const { archived } = parse(z.strictObject({ archived: bool }), request.query);
    return getMapPlace(deps, context(request), placeId(request), archived);
  });
  app.post('/places', write, async request => {
    const { place, operationId, checkMatches } = parse(z.strictObject({ place: z.unknown(), operationId: uuid, checkMatches: z.boolean().optional() }), request.body);
    return saveMapPlace(deps, context(request), place, operationId, undefined, checkMatches);
  });
  app.post('/places/:placeId/update', write, async request => {
    const { place, operationId, expectedRevision, archived } = parse(z.strictObject({ place: z.unknown(), operationId: uuid, expectedRevision: revision, archived: z.boolean() }), request.body);
    return saveMapPlace(deps, context(request), place, operationId, { id: placeId(request), revision: expectedRevision, archived });
  });
  app.post('/import-preview', write, async request => previewMapPlace(deps, context(request), request.body));
  app.post('/approaches', { bodyLimit: 24_000 }, async request => addMapApproach(deps, context(request), request.body));
  app.post('/tags', { bodyLimit: 1024 }, async request => {
    const { name, id } = parse(z.strictObject({ name: z.string().max(60), id: uuid.optional() }), request.body);
    return changeMapTag(deps, context(request), name, id ?? null);
  });
  app.get('/places/:placeId/personal', async request => mapPersonalState(deps, context(request), placeId(request)));
  app.post('/places/:placeId/personal', { bodyLimit: 1024 }, async request => {
    const state = parse(z.strictObject({ favorite: z.boolean(), want: z.boolean() }), request.body);
    return saveMapPersonalState(deps, context(request), placeId(request), state);
  });
  app.post('/places/:placeId/visits', { bodyLimit: 24_000 }, async request => recordMapVisit(deps, context(request), placeId(request), request.body));
}
