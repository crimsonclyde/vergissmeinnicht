import { getInstanceSettingsForAdmin, NotAuthorizedError } from '@vergissmeinnicht/application';
import { isActiveServerAdmin } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { MapDataManager } from '../map-data/manager.ts';
import { areaSchema } from '../map-data/area.ts';
import { mapBytes, type MapFetch } from '../map-data/remote.ts';
import { requireUser } from './session.ts';
import { InvalidRequestError } from './errors.ts';

const placeResults = z.object({ results: z.array(z.object({ name: z.string().max(100), latitude: z.number().min(-70).max(70), longitude: z.number().min(-175).max(175), country: z.string().max(100).optional(), admin1: z.string().max(100).optional() })).max(5).optional() });
const limit = (key: string, max: number) => ({ rateLimit: { persist: key, max, timeWindow: 15 * 60_000, hook: 'preHandler' as const,
  keyGenerator: (request: FastifyRequest) => `${key}:${request.principal?.user.id ?? request.ip}` } });
export async function mapDataRoutes(app: FastifyInstance, { services, manager, fetcher }: { services: AppServices; manager?: MapDataManager | undefined; fetcher?: MapFetch | undefined }) {
  app.addHook('preHandler', requireUser(services));
  app.addHook('preHandler', async request => {
    if (!request.principal) throw new NotAuthorizedError();
    await getInstanceSettingsForAdmin(services.instanceSettings, { actor: request.principal.user });
  });
  app.get('/', async () => ({ available: !!manager, ...(manager?.status() ?? { installed: null, job: null }) }));
  app.get('/places', { config: limit('map-place-search', 30) }, async (request, reply) => {
    const query = z.strictObject({ search: z.string().trim().min(2).max(100).refine(s => !/[\p{Cc}\p{Cf}]/u.test(s)) }).safeParse(request.query);
    if (!query.success) throw new InvalidRequestError();
    try {
      const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: query.data.search, count: '5', language: 'en', format: 'json' });
      const { bytes } = await mapBytes(url, 64_000, fetcher ? { fetch: fetcher } : {});
      const places = placeResults.parse(JSON.parse(bytes.toString())).results ?? [];
      return { places: places.map(p => ({ name: [p.name, p.admin1, p.country].filter(Boolean).join(', ').slice(0, 100), latitude: p.latitude, longitude: p.longitude })) };
    } catch { return reply.code(502).send({ error: 'map_download_failed' }); }
  });
  app.post('/download', { bodyLimit: 2048, config: limit('map-download', 3) }, async (request, reply) => {
    const parsed = z.strictObject({ area: areaSchema, expectedVersion: z.uuid().nullable() }).safeParse(request.body);
    if (!parsed.success) throw new InvalidRequestError();
    if (!manager) return reply.code(503).send({ error: 'map_download_unavailable' });
    if (manager.status().installed?.id !== (parsed.data.expectedVersion ?? undefined)) return reply.code(409).send({ error: 'map_download_changed' });
    const actor = request.principal?.user;
    if (!actor) throw new NotAuthorizedError();
    try {
      return await manager.start(parsed.data.area, actor.id, async () => {
        const current = await services.users.findById(actor.id);
        return !!current && isActiveServerAdmin(current);
      });
    } catch { return reply.code(409).send({ error: 'map_download_busy' }); }
  });
  app.post('/cancel', { bodyLimit: 128 }, async (request, reply) => {
    if (!z.strictObject({}).safeParse(request.body).success) throw new InvalidRequestError();
    if (!manager) return reply.code(503).send({ error: 'map_download_unavailable' });
    return manager.cancel();
  });
}
