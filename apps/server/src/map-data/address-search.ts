import { createHash } from 'node:crypto';
import { z } from 'zod';
import { mapBytes, type MapFetch } from './remote.ts';

export const addressQuery = z.string().trim().min(3).max(360).refine(text => !/[\p{Cc}\p{Cf}]/u.test(text));
const text = z.string().max(200);
const properties = z.object({ name: text.optional(), street: text.optional(), housenumber: text.optional(), postcode: text.optional(),
  city: text.optional(), district: text.optional(), state: text.optional(), country: text.optional(),
  osm_type: z.enum(['N', 'W', 'R']).optional(), osm_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  type: text.optional(), osm_key: text.optional(), osm_value: text.optional(),
});
const responseSchema = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
  type: z.literal('Feature'), properties, geometry: z.object({ type: z.literal('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
})).max(5) });
export interface AddressCandidate { label: string; latitude: number; longitude: number; sourceUrl: string; approximate: boolean }
export class AddressSearchBusy extends Error {}
export class AddressSearchUnavailable extends Error {}
/** One process owns the fixed provider budget. Results never cross Workspace cache keys. */
export function createAddressSearch(fetcher: MapFetch = globalThis.fetch) {
  const cache = new Map<string, { until: number; candidates: AddressCandidate[] }>();
  let busy = false, nextRequest = 0;
  return async (workspaceId: string, input: string): Promise<AddressCandidate[]> => {
    const query = addressQuery.parse(input);
    const key = workspaceId + ':' + createHash('sha256').update(query.toLowerCase()).digest('hex');
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.until > now) return structuredClone(cached.candidates);
    if (busy || now < nextRequest) throw new AddressSearchBusy();
    busy = true; nextRequest = now + 1000;
    try {
      const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q: query, limit: '5', lang: 'en' });
      const { bytes } = await mapBytes(url, 256_000, { fetch: fetcher, signal: AbortSignal.timeout(10_000) });
      const result = responseSchema.parse(JSON.parse(bytes.toString()));
      const candidates = result.features.map(feature => {
        const p = feature.properties;
        const kind = p.osm_type === 'N' ? 'node' : p.osm_type === 'W' ? 'way' : 'relation';
        return {
          label: [...new Set([p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.postcode, p.city ?? p.district, p.state, p.country].filter(Boolean))].join(', ').slice(0, 600),
          latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0],
          sourceUrl: p.osm_type && p.osm_id ? `https://www.openstreetmap.org/${kind}/${p.osm_id}` : 'https://www.openstreetmap.org/copyright',
          // An address number is still a provider suggestion; the editor explicitly reviews precision.
          approximate: !(p.housenumber && (p.type === 'house' || p.osm_key === 'building')),
        };
      });
      for (const [id, entry] of cache) if (entry.until <= now) cache.delete(id);
      if (cache.size >= 100) { const first = cache.keys().next().value; if (first) cache.delete(first); }
      cache.set(key, { until: now + 60 * 60_000, candidates });
      return structuredClone(candidates);
    } catch { throw new AddressSearchUnavailable(); }
    finally { busy = false; }
  };
}
