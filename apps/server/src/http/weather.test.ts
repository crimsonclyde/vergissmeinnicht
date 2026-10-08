import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

/** Recorded provider answers (Triora, 2026-10-08): weather tests never reach a provider. */
const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../../packages/weather/src/fixtures', name), 'utf8');
const TRIORA = { name: 'Triora', latitude: 43.993, longitude: 7.7637, timeZone: 'Europe/Rome', elevation: 780 };
const SETTINGS = { location: TRIORA, provider: 'AUTO', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true };

describe('Weather over HTTP (19.4a)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let requests: URL[];
  let metDown: boolean;

  beforeEach(async () => {
    requests = [];
    metDown = false;
    t = await startTestApp({
      weatherFetch: (async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url);
        const json = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.host === 'geocoding-api.open-meteo.com') return json(fixture('open-meteo-geocoding.json'));
        if (url.host === 'api.open-meteo.com') return json(fixture((url.searchParams.get('models') ?? '').includes(',') ? 'open-meteo-coverage.json' : 'open-meteo-best-match.json'));
        if (url.host === 'api.met.no') return metDown ? new Response('', { status: 503 }) : json(fixture('met-norway-compact.json'));
        throw new TypeError('unexpected host');
      }) as typeof fetch,
    });
    bob = await t.invite('bob@example.org', 'Bob');
  });
  afterEach(() => t.close());

  it('keeps each person’s settings to themselves, validates strictly and fetches nothing while saving', async () => {
    expect((await t.get('/api/account/weather', bob)).json()).toEqual({
      settings: { location: null, provider: 'AUTO', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true },
      providers: ['OPEN_METEO', 'MET_NORWAY'],
    });
    const saved = (await t.post('/api/account/weather', { settings: SETTINGS }, bob)).json();
    // Rounded to 2 decimals before storage (≈ 1 km).
    expect(saved.settings.location).toEqual({ name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: 780 });
    expect(requests).toEqual([]);
    expect((await t.get('/api/account/weather', t.admin)).json().settings.location).toBeNull();
    for (const settings of [
      { ...SETTINGS, extra: 1 },
      { ...SETTINGS, provider: 'YR' },
      { ...SETTINGS, model: 'my_model' },
      { ...SETTINGS, unit: 'K' },
      { ...SETTINGS, location: { ...TRIORA, latitude: 91 } },
      { ...SETTINGS, location: { ...TRIORA, timeZone: 'Mars/Olympus' } },
      { ...SETTINGS, location: { ...TRIORA, elevation: 10000 } },
      { ...SETTINGS, location: { ...TRIORA, name: 'Tri‮ora' } },
      { ...SETTINGS, location: { ...TRIORA, userId: 'someone' } },
    ]) {
      expect((await t.post('/api/account/weather', { settings }, bob)).statusCode).toBe(400);
    }
    expect((await t.post('/api/account/weather', { settings: SETTINGS, userId: 'x' }, bob)).statusCode).toBe(400);
    expect((await t.get('/api/account/weather')).statusCode).toBe(401);
    expect((await t.post('/api/account/weather', { settings: SETTINGS }, bob, null)).statusCode).toBe(403);
  });

  it('searches places and lists the Open-Meteo models that cover the place, with their limits (W2)', async () => {
    expect((await t.get('/api/account/weather/places?q=Triora&lang=de', bob)).json().places[0]).toMatchObject({ name: 'Triora', context: 'Liguria, Italy', timeZone: 'Europe/Rome' });
    expect(requests[0]?.searchParams.get('language')).toBe('de');
    expect((await t.get('/api/account/weather/places?q=T', bob)).statusCode).toBe(400);
    const models = (await t.post('/api/account/weather/models', { location: TRIORA }, bob)).json().models as { id: string; days: number | null; hasPrecipitationProbability: boolean | null }[];
    expect(models[0]).toMatchObject({ id: 'best_match', days: null });
    expect(models.find((model) => model.id === 'italia_meteo_arpae_icon_2i')).toMatchObject({ days: 3, hasPrecipitationProbability: false });
    // Not covering Triora: not offered.
    expect(models.map((model) => model.id)).not.toContain('metno_nordic');
    // Asked once per place: the second time comes from the cache.
    const before = requests.length;
    await t.post('/api/account/weather/models', { location: TRIORA }, bob);
    expect(requests.length).toBe(before);
  });

  it('returns the person’s forecast with its source; no location or no provider is an empty answer, not an error', async () => {
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'no_location' });
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'MET_NORWAY' } }, bob);
    const answer = (await t.get('/api/account/weather/forecast', bob)).json();
    expect(answer).toMatchObject({ forecast: { provider: 'MET_NORWAY', current: { temperature: 14.9 } }, location: { name: 'Triora' }, stale: false, fellBackFrom: null, unit: 'C' });
    expect(requests.at(-1)?.searchParams.get('altitude')).toBe('780');
    // MET down, no fallback chosen: nothing — with the reason for the Weather page.
    metDown = true;
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'MET_NORWAY', location: { ...TRIORA, elevation: null } } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'unavailable' });
    // With fallback allowed: Open-Meteo, labelled.
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'MET_NORWAY', fallback: true, location: { ...TRIORA, elevation: null } } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toMatchObject({ forecast: { provider: 'OPEN_METEO' }, fellBackFrom: 'MET_NORWAY' });
  });

  it('lets only server admins change the server’s weather settings, audited; switched off, every weather route is gone and nothing is fetched (W1)', async () => {
    expect((await t.get('/api/admin/weather', bob)).statusCode).toBe(403);
    expect((await t.post('/api/admin/weather', { enabled: false, allowed: [], metContact: null }, bob)).statusCode).toBe(403);
    expect((await t.get('/api/admin/weather', t.admin)).json().settings).toEqual({ enabled: true, allowed: ['OPEN_METEO', 'MET_NORWAY', 'OPENWEATHER', 'METEOMATICS'], metContact: null });
    expect((await t.post('/api/admin/weather', { enabled: true, allowed: ['MET_NORWAY'], metContact: 'not an address' }, t.admin)).statusCode).toBe(400);
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    await t.post('/api/admin/weather', { enabled: true, allowed: ['MET_NORWAY'], metContact: 'weather@example.org' }, t.admin);
    expect((await t.get('/api/account/weather', bob)).json().providers).toEqual(['MET_NORWAY']);
    // Automatic uses MET only now; its User-Agent names the admin's contact.
    expect((await t.get('/api/account/weather/forecast', bob)).json().forecast.provider).toBe('MET_NORWAY');
    expect((await t.get('/api/account/weather/places?q=Triora', bob)).json()).toEqual({ error: 'weather_unavailable', reason: 'not_allowed' });
    const events = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'WEATHER_SETTINGS_CHANGED'").all() as { metadata: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).not.toContain('weather@example.org');

    await t.post('/api/admin/weather', { enabled: false, allowed: ['OPEN_METEO', 'MET_NORWAY'], metContact: null }, t.admin);
    const before = requests.length;
    expect((await t.get('/api/account/weather', bob)).json()).toEqual({ error: 'weather_off' });
    for (const [method, url, body] of [
      ['GET', '/api/account/weather/forecast', undefined],
      ['GET', '/api/account/weather/places?q=Triora', undefined],
      ['POST', '/api/account/weather/models', { location: TRIORA }],
      ['POST', '/api/account/weather', { settings: SETTINGS }],
    ] as const) {
      const response = method === 'GET' ? await t.get(url, bob) : await t.post(url, body, bob);
      expect({ url, status: response.statusCode }).toEqual({ url, status: 404 });
    }
    expect(requests.length).toBe(before);
    // Switching on again: the saved settings are still there.
    await t.post('/api/admin/weather', { enabled: true, allowed: ['OPEN_METEO', 'MET_NORWAY'], metContact: null }, t.admin);
    expect((await t.get('/api/account/weather', bob)).json().settings.location.name).toBe('Triora');
  });
});
