import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { bytesToHeader, PMTiles, zxyToTileId, type Entry } from 'pmtiles';
import { areaBounds, areaSchema } from './area.ts';
import { decodeDirectory, encodeDirectory, unpack } from './directory.ts';
import { extractMap, wantedTiles } from './extract.ts';
import { allowedMapUrl, mapBytes, type MapFetch } from './remote.ts';
import { MapDataManager, type MapRunner } from './manager.ts';
import { downloadMap } from './download.ts';

const area = { name: 'Triora, Italy', latitude: 43.99252, longitude: 7.76624, radiusKm: 100 };
const dirs: string[] = [];
async function temp() { const dir = await mkdtemp(join(tmpdir(), 'vmn-map-test-')); dirs.push(dir); return dir; }
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function fixture(reordered = false) {
  // A real protobuf MVT layer with no features (layer name roads, extent 4096, version 2).
  const tile = gzipSync(Buffer.from([0x1a, 0x0c, 0x0a, 0x05, ...Buffer.from('roads'), 0x28, 0x80, 0x20, 0x78, 0x02]));
  const id = zxyToTileId(14, 8545, 5958);
  const foreign = zxyToTileId(14, 0, 0);
  const entries: Entry[] = [foreign, id].sort((a, b) => a - b).map((tileId, index) => ({ tileId, length: tile.length, offset: index * tile.length, runLength: 1 }));
  const leaf = encodeDirectory(entries), root = encodeDirectory([{ tileId: 0, offset: 0, length: leaf.length, runLength: 0 }]);
  const metadata = gzipSync(Buffer.from(JSON.stringify({ attribution: '<img src=x onerror=alert(1)>', vector_layers: ['roads', 'water', 'places', 'landuse', 'landcover'].map(id => ({ id, fields: {} })) })));
  const h = Buffer.alloc(127); h.write('PMTiles'); h[7] = 3;
  const tileOffset = reordered ? 127 + root.length : 127 + root.length + metadata.length + leaf.length;
  const metaOffset = reordered ? tileOffset + tile.length * 2 : 127 + root.length;
  const leafOffset = metaOffset + metadata.length;
  [127, root.length, metaOffset, metadata.length, leafOffset, leaf.length, tileOffset, tile.length * 2, 2, 2, 2].forEach((n, i) => h.writeBigUInt64LE(BigInt(n), 8 + i * 8));
  h[96] = 1; h[97] = 2; h[98] = 2; h[99] = 1; h[100] = 0; h[101] = 14;
  return { bytes: Buffer.concat(reordered ? [h, root, tile, tile, metadata, leaf] : [h, root, metadata, leaf, tile, tile]), tile, id };
}
const fetchReply = (body: string, status = 200, headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as MapFetch;

describe('managed map security and extraction', () => {
  it('bounds geographic input and includes the full requested radius', () => {
    const b = areaBounds(area);
    expect(b[0]).toBeCloseTo(6.5161, 3); expect(b[3]).toBeCloseTo(44.8918, 3);
    for (const change of [{ radiusKm: 201 }, { latitude: 90 }, { longitude: NaN }, { url: 'https://evil.invalid' }, { name: 'Triora\nInjected' }]) expect(areaSchema.safeParse({ ...area, ...change }).success).toBe(false);
    expect(wantedTiles(area, 15).length).toBeLessThan(100_000);
  });
  it('refuses nonallowlisted URLs before any network request', async () => {
    const bad = ['http://build.protomaps.com/20261117.pmtiles', 'https://127.0.0.1/20261117.pmtiles', 'https://build.protomaps.com.evil.invalid/20261117.pmtiles', 'https://build.protomaps.com:444/20261117.pmtiles', 'https://user:secret@build.protomaps.com/20261117.pmtiles', 'https://build.protomaps.com/20261117.pmtiles?next=evil', 'https://build.protomaps.com/../secret'];
    for (const url of bad) { expect(allowedMapUrl(url)).toBe(false); await expect(mapBytes(url, 10)).rejects.toThrow('map_source'); }
  });
  it('disables redirects and credentials and rejects oversized or incomplete responses', async () => {
    const url = 'https://build.protomaps.com/20261117.pmtiles';
    const fetcher = (async (_url, options) => { expect(options?.redirect).toBe('error'); expect(options?.credentials).toBe('omit'); return new Response('x', { status: 302, headers: { location: 'http://127.0.0.1' } }); }) as MapFetch;
    await expect(mapBytes(url, 10, { fetch: fetcher })).rejects.toThrow('map_response');
    await expect(mapBytes(url, 2, { fetch: fetchReply('toolong') })).rejects.toThrow('map_size');
    await expect(mapBytes(url, 10, { range: { offset: 0, length: 10 }, fetch: fetchReply('short', 206, { 'content-range': 'bytes 0-9/100' }) })).rejects.toThrow('map_range');
    await expect(mapBytes(url, 10, { range: { offset: 0, length: 10 }, fetch: fetchReply('0123456789', 200) })).rejects.toThrow('map_range');
    await expect(mapBytes(url, 10, { etag: '"one"', fetch: fetchReply('x', 200, { etag: '"two"' }) })).rejects.toThrow('map_changed');
  });
  it('rejects decompression bombs, malformed directories and huge counts', () => {
    expect(() => unpack(gzipSync(Buffer.alloc(9 * 1024 * 1024)), 2)).toThrow();
    for (const bad of [Buffer.from([128]), Buffer.from([1]), Buffer.from([255, 255, 255, 127])]) expect(() => decodeDirectory(bad, 1)).toThrow();
    const entries = [{ tileId: 1, runLength: 4, length: 20, offset: 0 }, { tileId: 8, runLength: 1, length: 5, offset: 20 }];
    expect(decodeDirectory(encodeDirectory(entries), 2)).toEqual(entries);
  });
  it('extracts only regional tiles and produces an archive readable by PMTiles', async () => {
    const dir = await temp(), source = fixture(true);
    const result = await extractMap(async (offset, length) => source.bytes.subarray(offset, offset + length), join(dir, 'region.pmtiles'), area, () => undefined);
    expect(result.tiles).toBe(1);
    const output = await readFile(join(dir, 'region.pmtiles'));
    const header = bytesToHeader(output.buffer.slice(output.byteOffset, output.byteOffset + 127));
    expect(header.centerLon).toBeCloseTo(area.longitude); expect(header.numAddressedTiles).toBe(1);
    const archive = new PMTiles({ getKey: () => 'fixture', getBytes: async (offset, length) => ({ data: Uint8Array.from(output.subarray(offset, offset + length)).buffer }) });
    const extracted = await archive.getZxy(14, 8545, 5958);
    if (!extracted) throw new Error('missing tile');
    expect(Buffer.from(extracted.data)).toEqual(unpack(source.tile, 2));
    expect(await archive.getZxy(14, 0, 0)).toBeUndefined();
    expect((await archive.getMetadata()).attribution).toBe('© OpenStreetMap contributors');
  });
  it('downloads a complete package from fixed provider fixtures without live network calls', async () => {
    const source = fixture(true), directory = await temp(); let requests = 0;
    const fetcher = (async (url, options) => {
      requests++; expect(allowedMapUrl(String(url))).toBe(true);
      if (String(url).endsWith('/builds.json')) return new Response(JSON.stringify([{ key: '20261117.pmtiles', version: '4.15.2', size: source.bytes.length }]));
      if (String(url).includes('build.protomaps.com')) {
        const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options?.headers).get('range') ?? '');
        if (!range) throw new Error('Expected bounded range');
        const offset = Number(range[1]), end = Number(range[2]);
        return new Response(source.bytes.subarray(offset, end + 1), { status: 206, headers: { etag: '"fixture"', 'content-range': `bytes ${offset}-${end}/${source.bytes.length}` } });
      }
      return new Response(String(url).endsWith('OFL.txt') ? 'OFL fixture' : new Uint8Array([10, 0]));
    }) as MapFetch;
    const result = await downloadMap(directory, area, () => undefined, new AbortController().signal, fetcher);
    expect(result).toMatchObject({ tiles: 1, build: '20261117', sourceVersion: '4.15.2' });
    expect(requests).toBeLessThan(300);
    expect(await readFile(join(directory, 'fonts', 'Noto Sans Regular', '65280-65535.pbf'))).toEqual(Buffer.from([10, 0]));
  });
  it('refuses changed archive versions and malformed glyph responses before installation', async () => {
    for (const failure of ['etag', 'glyph']) {
      const source = fixture(true), directory = await temp(); let ranges = 0;
      const fetcher = (async (url, options) => {
        if (String(url).endsWith('/builds.json')) return new Response(JSON.stringify([{ key: '20261117.pmtiles', version: '4.15.2', size: source.bytes.length }]));
        if (String(url).includes('build.protomaps.com')) {
          const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options?.headers).get('range') ?? '');
          if (!range) throw new Error('Expected range');
          const offset = Number(range[1]), end = Number(range[2]);
          return new Response(source.bytes.subarray(offset, end + 1), { status: 206, headers: {
            etag: failure === 'etag' && ranges++ > 0 ? '"changed"' : '"fixture"', 'content-range': `bytes ${offset}-${end}/${source.bytes.length}`,
          } });
        }
        return new Response('<html>Unexpected provider error</html>');
      }) as MapFetch;
      await expect(downloadMap(directory, area, () => undefined, new AbortController().signal, fetcher)).rejects.toThrow(failure === 'etag' ? 'map_changed' : 'map_font');
    }
  });
  it('refuses unsupported headers and hostile source metadata without creating an archive', async () => {
    const dir = await temp(), source = fixture(); source.bytes[99] = 2;
    await expect(extractMap(async (offset, length) => source.bytes.subarray(offset, offset + length), join(dir, 'map'), area, () => undefined)).rejects.toThrow('map_format');
    await expect(downloadMap(dir, area, () => undefined, new AbortController().signal, fetchReply(JSON.stringify([{ key: 'https://127.0.0.1/', version: '4.0', size: 1 }])))).rejects.toThrow('map_build');
  });
});

const runner: MapRunner = async (dir, _area, report) => {
  await mkdir(join(dir, 'fonts', 'Noto Sans Regular'), { recursive: true });
  await writeFile(join(dir, 'fonts', 'Noto Sans Regular', '0-255.pbf'), Buffer.from([10, 0]));
  await writeFile(join(dir, 'fonts', 'OFL.txt'), 'Font license fixture');
  await writeFile(join(dir, 'region.pmtiles'), fixture().bytes);
  report(99); return { bytes: 100, tiles: 1, maxZoom: 14, build: '20261117', sourceVersion: '4.15.2', receivedBytes: 100 };
};
async function finished(manager: MapDataManager) {
  for (let i = 0; i < 200 && manager.status().job?.state === 'downloading'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(manager.status().job?.state).not.toBe('downloading');
}
describe('atomic map installation', () => {
  it('preserves the installed version after failure, cancellation and interrupted staging', async () => {
    const dir = await temp(); const admin = randomUUID();
    const first = new MapDataManager(dir, runner); await first.init(); await first.start(area, admin, async () => true); await finished(first);
    const installed = first.status().installed; expect(installed?.actorId).toBe(admin);
    if (!installed) throw new Error('missing install');
    expect(first.manifest().archive).toContain(installed.id);
    const failure = new MapDataManager(dir, async () => { throw new Error('provider failure'); });
    await failure.init(); await failure.start(area, admin, async () => true); await finished(failure);
    expect(failure.status().job?.state).toBe('failed'); expect(failure.status().installed).toEqual(installed);
    const cancelled = new MapDataManager(dir, async (_dir, _area, _report, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); if (signal.aborted) reject(new Error('cancelled')); }));
    await cancelled.init(); await cancelled.start(area, admin, async () => true);
    await expect(cancelled.start(area, admin, async () => true)).rejects.toThrow('map_busy');
    await cancelled.cancel(); expect(cancelled.status().job?.state).toBe('cancelled'); expect(cancelled.status().installed).toEqual(installed);
    const staging = join(dir, 'staging-' + randomUUID()); await mkdir(staging); await writeFile(join(staging, 'partial'), 'partial');
    const restarted = new MapDataManager(dir, runner); await restarted.init(); expect(restarted.status().installed).toEqual(installed);
    await expect(readFile(join(staging, 'partial'))).rejects.toThrow();
  });
  it('rechecks admin authority before publishing completed downloads', async () => {
    const manager = new MapDataManager(await temp(), runner); await manager.init();
    await manager.start(area, randomUUID(), async () => false); await finished(manager);
    expect(manager.status().installed).toBeNull(); expect(manager.status().job?.state).toBe('failed');
  });
});
