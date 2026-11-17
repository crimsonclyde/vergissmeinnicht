import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { extractMap, MAX_MAP_BYTES } from './extract.ts';
import { mapBytes, type MapFetch } from './remote.ts';
import type { MapArea } from './area.ts';

const builds = z.array(z.object({ key: z.string(), version: z.string(), size: z.number().int().positive() })).max(512);
export async function downloadMap(directory: string, area: MapArea, report: (percent: number) => void, signal: AbortSignal, fetcher?: MapFetch) {
  let received = 0, requests = 0;
  const get = async (url: string, cap: number, range?: { offset: number; length: number }, etag?: string) => {
    if (++requests > 4096) throw new Error('map_requests');
    const result = await mapBytes(url, cap, { signal, ...(fetcher ? { fetch: fetcher } : {}), ...(range ? { range } : {}), ...(etag ? { etag } : {}) });
    received += result.bytes.length;
    if (received > MAX_MAP_BYTES + 128_000_000) throw new Error('map_size');
    return result;
  };
  const list = builds.parse(JSON.parse((await get('https://build-metadata.protomaps.dev/builds.json', 256_000)).bytes.toString()));
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const build = list.filter(b => /^\d{8}\.pmtiles$/.test(b.key) && b.key.slice(0, 8) <= today && /^4\./.test(b.version)).sort((a, b) => b.key.localeCompare(a.key))[0];
  if (!build) throw new Error('map_build');
  const url = 'https://build.protomaps.com/' + build.key;
  let sourceEtag: string | undefined;
  const result = await extractMap(async (offset, length) => {
    const response = await get(url, length, { offset, length }, sourceEtag);
    if (!response.etag || response.etag.startsWith('W/')) throw new Error('map_etag');
    sourceEtag = response.etag;
    return response.bytes;
  }, join(directory, 'region.pmtiles'), area, report);
  const fonts = join(directory, 'fonts', 'Noto Sans Regular');
  await mkdir(fonts, { recursive: true, mode: 0o700 });
  for (let i = 0; i < 256; i++) {
    const range = `${i * 256}-${i * 256 + 255}.pbf`;
    const data = (await get('https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/' + range, 256_000)).bytes;
    if (data.length < 2 || data[0] !== 10) throw new Error('map_font');
    await writeFile(join(fonts, range), data, { mode: 0o600 });
    report(85 + Math.floor((i + 1) / 256 * 14));
  }
  await writeFile(join(directory, 'fonts', 'OFL.txt'), (await get('https://protomaps.github.io/basemaps-assets/fonts/OFL.txt', 32_000)).bytes, { mode: 0o600 });
  return { ...result, build: build.key.slice(0, 8), sourceVersion: build.version, receivedBytes: received };
}
