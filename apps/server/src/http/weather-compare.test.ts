import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../../packages/weather/src/fixtures', name), 'utf8');
const TRIORA = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: null };
const SETTINGS = { location: TRIORA, provider: 'AUTO', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true };
const BOB_KEY = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const SERVER_KEY = '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e';
const FREE = [{ provider: 'OPEN_METEO' }, { provider: 'OPEN_METEO', model: 'italia_meteo_arpae_icon_2i' }, { provider: 'MET_NORWAY' }];

interface Result {
  provider: string;
  model: string | null;
  paid: boolean;
  queries: number;
  state: string;
  reason?: string;
  refreshFailed?: string | null;
  horizon?: number;
  fetchedAt?: string;
  forecast?: { provider: string; days: { date: string; partial?: boolean; precipitationProbabilityMax?: number; precipitationSum?: number }[] };
}

describe('Forecast comparison (19.4c)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let carol: string;
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
        if (url.host === 'api.open-meteo.com') return json(fixture(url.searchParams.get('models') === 'italia_meteo_arpae_icon_2i' ? 'open-meteo-icon-2i-16.json' : 'open-meteo-best-match-16.json'));
        if (url.host === 'api.met.no') return metDown ? new Response('', { status: 503 }) : json(fixture('met-norway-compact.json'));
        if (url.host === 'api.openweathermap.org') return json(fixture('openweather-onecall.json'));
        if (url.host === 'api.meteomatics.com') return json(fixture(url.pathname.startsWith('/now/') ? 'meteomatics-current.json' : 'meteomatics-daily.json'));
        throw new TypeError('unexpected host');
      }) as typeof fetch,
    });
    bob = await t.invite('bob@example.org', 'Bob');
    carol = await t.invite('carol@example.org', 'Carol');
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    await t.post('/api/account/weather', { settings: SETTINGS }, carol);
  });
  afterEach(() => t.close());

  const compare = async (cookie: string, sources: object[], fetchPaid = false) => {
    const response = await t.post('/api/account/weather/compare', { sources, fetchPaid }, cookie);
    expect(response.statusCode).toBe(200);
    return response.json().results as Result[];
  };
  const of = (results: Result[], provider: string, model: string | null = null) => results.find((result) => result.provider === provider && (model === null || result.model === model));
  const used = async (cookie: string, provider: string) =>
    ((await t.get('/api/account/weather', cookie)).json().credentialProviders as { provider: string; personal: { usedToday: number } | null }[]).find((entry) => entry.provider === provider)?.personal?.usedToday;

  it('compares several Open-Meteo models and MET Norway with each one’s own horizon, missing values kept missing', async () => {
    const results = await compare(bob, FREE);
    expect(results.map((result) => [result.provider, result.model, result.state, result.paid])).toEqual([
      ['OPEN_METEO', 'best_match', 'fresh', false],
      ['OPEN_METEO', 'italia_meteo_arpae_icon_2i', 'fresh', false],
      ['MET_NORWAY', null, 'fresh', false],
    ]);
    // Not cut to the shortest: 16, 3 and about 10 days.
    expect(of(results, 'OPEN_METEO', 'best_match')?.horizon).toBe(16);
    expect(of(results, 'OPEN_METEO', 'italia_meteo_arpae_icon_2i')?.horizon).toBe(3);
    expect(of(results, 'MET_NORWAY')?.horizon).toBeGreaterThanOrEqual(9);
    // ICON-2I has no rain probability: absent, never 0; dry days keep their measured 0 mm.
    for (const day of of(results, 'OPEN_METEO', 'italia_meteo_arpae_icon_2i')?.forecast?.days ?? []) expect(day).not.toHaveProperty('precipitationProbabilityMax');
    expect(of(results, 'OPEN_METEO', 'italia_meteo_arpae_icon_2i')?.forecast?.days[1]?.precipitationSum).toBe(0);
    // MET's first day covers only the rest of the day.
    expect(of(results, 'MET_NORWAY')?.forecast?.days[0]).toMatchObject({ date: '2026-10-08', partial: true });
  });

  it('uses the place’s time zone for every source', async () => {
    await t.post('/api/account/weather', { settings: { ...SETTINGS, location: { ...TRIORA, timeZone: 'Pacific/Auckland' } } }, bob);
    const results = await compare(bob, [{ provider: 'OPEN_METEO' }, { provider: 'MET_NORWAY' }]);
    expect(requests.find((url) => url.host === 'api.open-meteo.com')?.searchParams.get('timezone')).toBe('Pacific/Auckland');
    // MET's first instant (08:00 UTC on 8 October) is 21:00 in Auckland: the 8th is a partial day, the 9th starts at local midnight.
    const met = of(results, 'MET_NORWAY')?.forecast?.days ?? [];
    expect(met[0]).toMatchObject({ date: '2026-10-08', partial: true });
    expect(met[1]?.date).toBe('2026-10-09');
  });

  it('reuses cached forecasts: comparing again, and Today afterwards, make no new requests', async () => {
    await compare(bob, FREE);
    const before = requests.length;
    await compare(bob, FREE);
    expect((await t.get('/api/account/weather/forecast?days=2', bob)).json().forecast.provider).toBe('OPEN_METEO');
    expect(requests.length).toBe(before);
    // Comparing does not change the person's Today provider.
    expect((await t.get('/api/account/weather', bob)).json().settings.provider).toBe('AUTO');
  });

  it('never fetches a paid source without an explicit request, then counts every query against the budget', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 3 }, bob);
    await t.post('/api/account/weather/credentials', { provider: 'METEOMATICS', credential: { provider: 'METEOMATICS', username: 'bob_vmn', password: 'S3cret!pass' }, dailyBudget: 4 }, bob);
    expect(await used(bob, 'OPENWEATHER')).toBe(1); // the test when saving
    expect(await used(bob, 'METEOMATICS')).toBe(2);
    const paid = [{ provider: 'OPENWEATHER' }, { provider: 'METEOMATICS' }, { provider: 'OPEN_METEO' }];
    const before = requests.length;
    const first = await compare(bob, paid);
    expect(of(first, 'OPENWEATHER')).toMatchObject({ state: 'not_fetched', paid: true, queries: 1 });
    expect(of(first, 'METEOMATICS')).toMatchObject({ state: 'not_fetched', paid: true, queries: 2 });
    expect(of(first, 'OPEN_METEO')?.state).toBe('fresh');
    expect(requests.slice(before).every((url) => url.host === 'api.open-meteo.com')).toBe(true);
    expect(await used(bob, 'OPENWEATHER')).toBe(1);
    // Explicitly fetched: one OpenWeather call, two Meteomatics queries.
    const fetched = await compare(bob, paid, true);
    expect(of(fetched, 'OPENWEATHER')).toMatchObject({ state: 'fresh', horizon: 8 });
    expect(of(fetched, 'METEOMATICS')).toMatchObject({ state: 'fresh', horizon: 9 });
    expect(await used(bob, 'OPENWEATHER')).toBe(2);
    expect(await used(bob, 'METEOMATICS')).toBe(4);
    // Comparing again without asking: from the cache, free.
    const again = await compare(bob, paid);
    expect(of(again, 'OPENWEATHER')?.state).toBe('fresh');
    expect(await used(bob, 'OPENWEATHER')).toBe(2);
    // Meteomatics' budget (4) is used up: an explicit refresh of a new place is refused before any request…
    await t.post('/api/account/weather', { settings: { ...SETTINGS, location: { ...TRIORA, elevation: 700 } } }, bob);
    const meteomaticsBefore = requests.filter((url) => url.host === 'api.meteomatics.com').length;
    const refused = await compare(bob, paid, true);
    expect(of(refused, 'METEOMATICS')).toMatchObject({ state: 'failed', reason: 'budget_reached' });
    expect(requests.filter((url) => url.host === 'api.meteomatics.com').length).toBe(meteomaticsBefore);
    // …while the other sources are compared as usual.
    expect(of(refused, 'OPENWEATHER')?.state).toBe('fresh');
    expect(of(refused, 'OPEN_METEO')?.state).toBe('fresh');
  });

  it('answers a fresh cached paid forecast without spending budget, even when asked to fetch', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 2 }, bob);
    const fetched = await compare(bob, [{ provider: 'OPENWEATHER' }], true);
    expect(of(fetched, 'OPENWEATHER')?.state).toBe('fresh');
    // The budget is used up (test + this call); the fresh copy still answers, no request.
    const before = requests.length;
    const later = await compare(bob, [{ provider: 'OPENWEATHER' }], true);
    expect(of(later, 'OPENWEATHER')).toMatchObject({ state: 'fresh', fetchedAt: of(fetched, 'OPENWEATHER')?.fetchedAt });
    expect(requests.length).toBe(before);
  });

  it('never gives one person another’s credential or credential-scoped cache', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 50 }, bob);
    await compare(bob, [{ provider: 'OPENWEATHER' }], true);
    // Carol has no credential: no access to Bob's cached result, no request.
    const before = requests.length;
    expect(of(await compare(carol, [{ provider: 'OPENWEATHER' }], true), 'OPENWEATHER')).toMatchObject({ state: 'failed', reason: 'needs_credentials' });
    expect(requests.length).toBe(before);
    // With the server's shared credential she gets her own request with the server's key — not Bob's cache.
    await t.post('/api/admin/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: SERVER_KEY }, dailyBudget: 50, availableToUsers: true }, t.admin);
    expect(of(await compare(carol, [{ provider: 'OPENWEATHER' }]), 'OPENWEATHER')?.state).toBe('not_fetched');
    const beforeCarol = requests.length;
    expect(of(await compare(carol, [{ provider: 'OPENWEATHER' }], true), 'OPENWEATHER')?.state).toBe('fresh');
    expect(requests.slice(beforeCarol).map((url) => url.searchParams.get('appid'))).toEqual([SERVER_KEY]);
  });

  it('keeps comparing the other sources when one fails, and checks what is asked for', async () => {
    metDown = true;
    const results = await compare(bob, FREE);
    expect(of(results, 'MET_NORWAY')).toMatchObject({ state: 'failed', reason: 'unavailable' });
    expect(of(results, 'OPEN_METEO', 'best_match')?.state).toBe('fresh');
    for (const sources of [[], [{ provider: 'OPEN_METEO' }, { provider: 'OPEN_METEO' }], [{ provider: 'MET_NORWAY', model: 'icon_d2' }], [{ provider: 'OPEN_METEO', model: 'my_model' }], [{ provider: 'YR' }], Array.from({ length: 9 }, (_x, i) => ({ provider: 'OPEN_METEO', model: ['best_match', 'icon_d2', 'icon_eu', 'icon_seamless', 'ecmwf_ifs025', 'gfs_seamless', 'jma_seamless', 'gem_seamless', 'metno_seamless'][i] }))]) {
      expect((await t.post('/api/account/weather/compare', { sources, fetchPaid: false }, bob)).statusCode).toBe(400);
    }
    expect((await t.post('/api/account/weather/compare', { sources: FREE, fetchPaid: false })).statusCode).toBe(401);
    await t.post('/api/admin/weather', { enabled: false, allowed: ['OPEN_METEO', 'MET_NORWAY'], metContact: null }, t.admin);
    expect((await t.post('/api/account/weather/compare', { sources: FREE, fetchPaid: false }, bob)).statusCode).toBe(404);
  });

  it('needs a place first', async () => {
    await t.post('/api/account/weather', { settings: { ...SETTINGS, location: null } }, bob);
    expect((await t.post('/api/account/weather/compare', { sources: FREE, fetchPaid: false }, bob)).json()).toEqual({ location: null, results: [], reason: 'no_location' });
  });
});
