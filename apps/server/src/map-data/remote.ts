import { OutboundError, outboundAllowed, outboundFetch, readBounded, type Fetch } from '@vergissmeinnicht/outbound';

/** Fixed public providers only. No user-selected URLs, redirects, cookies or credentials (outbound client, 45.10). */
export type MapFetch = Fetch;
const mapPath = (u: URL): boolean => (u.hostname === 'build-metadata.protomaps.dev' && u.pathname === '/builds.json' && !u.search)
    || (u.hostname === 'build.protomaps.com' && /^\/\d{8}\.pmtiles$/.test(u.pathname) && !u.search)
    || (u.hostname === 'protomaps.github.io' && /^\/basemaps-assets\/fonts\/(?:Noto%20Sans%20Regular\/\d+-\d+\.pbf|OFL\.txt)$/.test(u.pathname) && !u.search)
    || (u.hostname === 'geocoding-api.open-meteo.com' && u.pathname === '/v1/search');
export function allowedMapUrl(url: string): boolean {
  return outboundAllowed(new URL(url), mapPath);
}
export async function mapBytes(url: string, limit: number, options: {
  fetch?: MapFetch; signal?: AbortSignal; range?: { offset: number; length: number }; etag?: string;
} = {}): Promise<{ bytes: Buffer; etag: string | null }> {
  if (!allowedMapUrl(url)) throw new Error('map_source');
  const headers: Record<string, string> = { 'User-Agent': 'VergissMeinNicht regional basemap', 'Accept-Encoding': 'identity' };
  if (options.range) headers.Range = `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`;
  if (options.etag) headers['If-Match'] = options.etag;
  const response = await outboundFetch(url, { allow: mapPath, headers, timeoutMs: 30_000, fetch: options.fetch, ...(options.signal ? { signal: options.signal } : {}) });
  try {
    if (options.range) {
      const { offset, length } = options.range;
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (response.status !== 206 || !match || Number(match[1]) !== offset || Number(match[2]) !== offset + length - 1
        || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= offset + length - 1) throw new Error('map_range');
    } else if (response.status !== 200) throw new Error('map_response');
    const etag = response.headers.get('etag');
    if (options.etag && etag !== options.etag) throw new Error('map_changed');
    if (!response.body) throw new Error('map_response');
    let bytes: Buffer;
    try { bytes = await readBounded(response, limit); }
    catch (error) { throw new Error(error instanceof OutboundError && error.reason !== 'unreachable' ? 'map_size' : 'map_response', { cause: error }); }
    if (options.range && bytes.length !== options.range.length) throw new Error('map_range');
    return { bytes, etag };
  } finally {
    if (!response.body?.locked) await response.body?.cancel().catch(() => undefined);
  }
}
