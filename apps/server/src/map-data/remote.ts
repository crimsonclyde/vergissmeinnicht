/** Fixed public providers only. No user-selected URLs, redirects, cookies or credentials. */
export type MapFetch = typeof fetch;
export function allowedMapUrl(url: string): boolean {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.hash) return false;
  return (u.hostname === 'build-metadata.protomaps.dev' && u.pathname === '/builds.json' && !u.search)
    || (u.hostname === 'build.protomaps.com' && /^\/\d{8}\.pmtiles$/.test(u.pathname) && !u.search)
    || (u.hostname === 'protomaps.github.io' && /^\/basemaps-assets\/fonts\/(?:Noto%20Sans%20Regular\/\d+-\d+\.pbf|OFL\.txt)$/.test(u.pathname) && !u.search)
    || (u.hostname === 'geocoding-api.open-meteo.com' && u.pathname === '/v1/search');
}
export async function mapBytes(url: string, limit: number, options: {
  fetch?: MapFetch; signal?: AbortSignal; range?: { offset: number; length: number }; etag?: string;
} = {}): Promise<{ bytes: Buffer; etag: string | null }> {
  if (!allowedMapUrl(url)) throw new Error('map_source');
  const headers: Record<string, string> = { 'User-Agent': 'VergissMeinNicht regional basemap', 'Accept-Encoding': 'identity' };
  if (options.range) headers.Range = `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`;
  if (options.etag) headers['If-Match'] = options.etag;
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]);
  const response = await (options.fetch ?? fetch)(url, { headers, signal, redirect: 'error', credentials: 'omit' });
  try {
    if (options.range) {
      const { offset, length } = options.range;
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (response.status !== 206 || !match || Number(match[1]) !== offset || Number(match[2]) !== offset + length - 1
        || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= offset + length - 1) throw new Error('map_range');
    } else if (response.status !== 200) throw new Error('map_response');
    const etag = response.headers.get('etag');
    if (options.etag && etag !== options.etag) throw new Error('map_changed');
    const size = response.headers.get('content-length');
    if (size !== null && (!/^\d+$/.test(size) || Number(size) > limit)) throw new Error('map_size');
    if (!response.body) throw new Error('map_response');
    const parts: Buffer[] = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > limit) throw new Error('map_size');
      parts.push(Buffer.from(chunk));
    }
    if (options.range && length !== options.range.length) throw new Error('map_range');
    return { bytes: Buffer.concat(parts), etag };
  } finally {
    if (!response.body?.locked) await response.body?.cancel().catch(() => undefined);
  }
}
