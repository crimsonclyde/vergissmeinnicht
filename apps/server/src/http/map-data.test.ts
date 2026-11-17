import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, startTestApp } from './test-harness.ts';

const area = { name: 'Triora, Italy', latitude: 43.99252, longitude: 7.76624, radiusKm: 100 };
const base = '/api/admin/map-data';
describe('server-admin regional map downloads', () => {
  let app: Awaited<ReturnType<typeof startTestApp>>;
  let plain: string;
  beforeEach(async () => {
    app = await startTestApp({ managedMapData: true,
      mapFetch: async (url, options) => {
        expect(String(url)).toContain('https://geocoding-api.open-meteo.com/v1/search?');
        expect(options?.redirect).toBe('error');
        return new Response(JSON.stringify({ results: [{ name: 'Triora', country: 'Italy', latitude: area.latitude, longitude: area.longitude }] }));
      },
      mapRunner: async (dir, _area, report, signal) => {
        if (signal.aborted) throw new Error('cancelled');
        await mkdir(join(dir, 'fonts', 'Noto Sans Regular'), { recursive: true });
        await writeFile(join(dir, 'fonts', 'Noto Sans Regular', '0-255.pbf'), Buffer.from([10, 0]));
  await writeFile(join(dir, 'fonts', 'OFL.txt'), 'Font license fixture');
        await writeFile(join(dir, 'region.pmtiles'), Buffer.from('PMTiles\x03fixture map'));
        report(99); return { bytes: 100, tiles: 1, maxZoom: 14, build: '20261117', sourceVersion: '4.15.2', receivedBytes: 100 };
      },
    });
    plain = await app.invite('map-ordinary@example.org', 'Ordinary');
  });
  afterEach(async () => app.close());
  it('requires authentication, ACTIVE server admin and same-origin writes', async () => {
    for (const [method, path, payload] of [['GET', '/', undefined], ['GET', '/places?search=Triora', undefined], ['POST', '/download', { area, expectedVersion: null }], ['POST', '/cancel', {}]] as const) {
      const anon = await app.app.inject({ method, url: base + path, ...(payload ? { payload } : {}), headers: { origin: ORIGIN } });
      expect(anon.statusCode).toBe(401);
      const denied = method === 'GET' ? await app.get(base + path, plain) : await app.post(base + path, payload, plain);
      expect(denied.statusCode).toBe(403);
    }
    const csrf = await app.app.inject({ method: 'POST', url: base + '/download', payload: { area, expectedVersion: null }, headers: { cookie: app.admin, origin: 'https://evil.invalid' } });
    expect(csrf.statusCode).toBe(403);
    expect((await app.get(base + '/', app.admin)).json().job).toBeNull();
  });
  it('rejects malformed area inputs', async () => {
    for (const change of [{ radiusKm: 500 }, { latitude: 91 }, { url: 'https://evil.invalid' }]) {
      expect((await app.post(base + '/download', { area: { ...area, ...change }, expectedVersion: null }, app.admin)).statusCode).toBe(400);
    }
  });
  it('searches localities, validates downloads, installs and serves versioned HTTP byte ranges', async () => {
    expect((await app.get(base + '/places?search=Triora', app.admin)).json().places[0]).toMatchObject({ name: 'Triora, Italy' });
    const start = await app.post(base + '/download', { area, expectedVersion: null }, app.admin);
    expect(start.statusCode, start.body).toBe(200);
    let status = (await app.get(base + '/', app.admin)).json();
    for (let i = 0; status.job.state === 'downloading' && i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10)); status = (await app.get(base + '/', app.admin)).json();
    }
    expect(status.job.state).toBe('installed'); expect(status.installed.area).toEqual(area);
    const manifest = (await app.app.inject('/map-assets/current.json')).json();
    expect(manifest.archive).toContain(status.installed.id);
    const range = await app.app.inject({ url: manifest.archive, headers: { range: 'bytes=0-7' } });
    expect(range.statusCode).toBe(206); expect(range.rawPayload).toEqual(Buffer.from('PMTiles\x03'));
    expect((await app.app.inject(manifest.archive.replace('region.pmtiles', 'install.json'))).statusCode).toBe(404);
    expect((await app.post(base + '/download', { area, expectedVersion: null }, app.admin)).statusCode).toBe(409);
  });
});
