import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../../packages/weather/src/fixtures', name), 'utf8');
const TRIORA = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: null };
const SETTINGS = { location: TRIORA, provider: 'OPENWEATHER', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true };
const BOB_KEY = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const SERVER_KEY = '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e';
const WRONG_KEY = 'ffffffffffffffffffffffffffffffff';
const SECRET_PASSWORD = 'Very$ecretMeteo1';

describe('Weather provider credentials over HTTP (19.4b)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let carol: string;
  let requests: URL[];
  let openWeatherDown: boolean;

  beforeEach(async () => {
    requests = [];
    openWeatherDown = false;
    t = await startTestApp({
      captureLogs: true,
      weatherFetch: (async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url);
        const json = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.host === 'api.openweathermap.org') {
          if (url.searchParams.get('appid') === WRONG_KEY) return new Response(`{"cod":401,"message":"Invalid API key ${WRONG_KEY}"}`, { status: 401 });
          return openWeatherDown ? new Response('', { status: 503 }) : json(fixture('openweather-onecall.json'));
        }
        if (url.host === 'api.meteomatics.com') return json(fixture(url.pathname.startsWith('/now/') ? 'meteomatics-current.json' : 'meteomatics-daily.json'));
        if (url.host === 'api.open-meteo.com') return json(fixture('open-meteo-best-match-16.json'));
        if (url.host === 'api.met.no') return json(fixture('met-norway-compact.json'));
        throw new TypeError('unexpected host');
      }) as typeof fetch,
    });
    bob = await t.invite('bob@example.org', 'Bob');
    carol = await t.invite('carol@example.org', 'Carol');
  });
  afterEach(() => t.close());

  const status = (cookie: string, provider = 'OPENWEATHER') =>
    t.get('/api/account/weather', cookie).then((response) => (response.json().credentialProviders as { provider: string; personal: unknown; serverAdmin?: unknown; serverAvailable: boolean }[]).find((entry) => entry.provider === provider));
  const everythingSaid = () => [JSON.stringify(t.database.sqlite.prepare('SELECT * FROM weather_credentials').all()), JSON.stringify(t.database.sqlite.prepare('SELECT * FROM security_events').all()), t.logs].join('\n');

  it('works without any commercial credentials: Automatic, Open-Meteo and MET Norway need none', async () => {
    const mine = (await t.get('/api/account/weather', bob)).json();
    expect(mine.providers).toEqual(['OPEN_METEO', 'MET_NORWAY']);
    expect(mine.credentialProviders).toEqual([
      { provider: 'OPENWEATHER', allowed: true, personal: null, serverAvailable: false },
      { provider: 'METEOMATICS', allowed: true, personal: null, serverAvailable: false },
    ]);
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'AUTO' } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json().forecast.provider).toBe('OPEN_METEO');
    // A credential provider without credentials: nothing is asked, and the reason says why.
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    const before = requests.length;
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'needs_credentials' });
    expect(requests.length).toBe(before);
  });

  it('keeps a personal key to its owner: tested before storing, sealed, status only, never in responses, records, events or logs', async () => {
    const bad = await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: WRONG_KEY }, dailyBudget: 100 }, bob);
    expect({ status: bad.statusCode, body: bad.json() }).toEqual({ status: 400, body: { error: 'weather_unavailable', reason: 'invalid_credentials' } });
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM weather_credentials').get()).toEqual({ n: 0 });

    const saved = await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 100 }, bob);
    expect(saved.json().status).toMatchObject({ provider: 'OPENWEATHER', readable: true, dailyBudget: 100, usedToday: 1, lastTest: { ok: true } });
    expect(JSON.stringify(saved.json())).not.toContain(BOB_KEY);
    expect(JSON.stringify((await t.get('/api/account/weather', bob)).json())).not.toContain(BOB_KEY);
    expect((await status(bob))?.personal).toMatchObject({ readable: true });
    // Another person: sees no trace of it and cannot use it.
    expect(await status(carol)).toEqual({ provider: 'OPENWEATHER', allowed: true, personal: null, serverAvailable: false });
    expect((await t.get('/api/account/weather', carol)).json().providers).not.toContain('OPENWEATHER');
    // Sealed at rest; no event or log line holds it.
    expect(everythingSaid()).not.toContain(BOB_KEY);
    expect(t.database.sqlite.prepare("SELECT sealed FROM weather_credentials").get()).toMatchObject({ sealed: expect.stringMatching(/^v1\./) });
    expect(t.database.sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE type = 'WEATHER_CREDENTIAL_CHANGED'").get()).toEqual({ n: 1 });

    // Bob's forecast uses his key; it is listed as a choice for him only.
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toMatchObject({ forecast: { provider: 'OPENWEATHER' }, horizon: 8 });
    expect(requests.at(-1)?.searchParams.get('appid')).toBe(BOB_KEY);
    // Carol cannot overwrite or remove it: her requests only ever address her own credentials.
    expect((await t.post('/api/account/weather/credentials/delete', { provider: 'OPENWEATHER' }, carol)).statusCode).toBe(404);
    expect((await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', dailyBudget: 5 }, carol)).statusCode).toBe(400);
    expect((await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 5, userId: 'bob' }, carol)).statusCode).toBe(400);
    expect((await status(bob))?.personal).toMatchObject({ dailyBudget: 100 });
    // Removing it: gone, Bob's choice no longer works, nothing else changes.
    expect((await t.post('/api/account/weather/credentials/delete', { provider: 'OPENWEATHER' }, bob)).statusCode).toBe(204);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM weather_credentials').get()).toEqual({ n: 0 });
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'needs_credentials' });
  });

  it('lets only server admins manage server-wide credentials; people use them only when made available; their own come first', async () => {
    const serverCredential = { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: SERVER_KEY }, dailyBudget: 50, availableToUsers: false };
    expect((await t.post('/api/admin/weather/credentials', serverCredential, bob)).statusCode).toBe(403);
    expect((await t.get('/api/admin/weather/credentials', bob)).statusCode).toBe(403);
    expect((await t.post('/api/admin/weather/credentials', serverCredential, t.admin)).json().status).toMatchObject({ readable: true, availableToUsers: false });
    expect(JSON.stringify((await t.get('/api/admin/weather/credentials', t.admin)).json())).not.toContain(SERVER_KEY);
    // Not available to users yet: Carol cannot use it.
    expect(await status(carol)).toMatchObject({ serverAvailable: false });
    await t.post('/api/account/weather', { settings: SETTINGS }, carol);
    expect((await t.get('/api/account/weather/forecast', carol)).json()).toEqual({ forecast: null, reason: 'needs_credentials' });
    // Made available (no new secret needed): Carol's forecast uses the server's key.
    expect((await t.post('/api/admin/weather/credentials', { provider: 'OPENWEATHER', dailyBudget: 50, availableToUsers: true }, t.admin)).statusCode).toBe(200);
    expect(await status(carol)).toMatchObject({ serverAvailable: true, personal: null });
    expect((await t.get('/api/account/weather/forecast', carol)).json().forecast.provider).toBe('OPENWEATHER');
    expect(requests.at(-1)?.searchParams.get('appid')).toBe(SERVER_KEY);
    // Bob has his own key: it takes precedence — and his result is never served to Carol from the cache, nor hers to him.
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 100 }, bob);
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    const before = requests.length;
    await t.get('/api/account/weather/forecast', bob);
    expect(requests.slice(before).map((url) => url.searchParams.get('appid'))).toEqual([BOB_KEY]);
    await t.get('/api/account/weather/forecast', carol);
    await t.get('/api/account/weather/forecast', bob);
    expect(requests.length).toBe(before + 1); // both answered from their own cache entries
    expect(everythingSaid()).not.toContain(SERVER_KEY);
    // Only the admin removes it; afterwards Carol is back to needing credentials, Bob unaffected.
    expect((await t.post('/api/admin/weather/credentials/delete', { provider: 'OPENWEATHER' }, bob)).statusCode).toBe(403);
    expect((await t.post('/api/admin/weather/credentials/delete', { provider: 'OPENWEATHER' }, t.admin)).statusCode).toBe(204);
    expect(await status(carol)).toMatchObject({ serverAvailable: false });
    expect((await status(bob))?.personal).toMatchObject({ readable: true });
  });

  it('stops at the daily budget before any call, and never above the provider’s free allowance', async () => {
    expect((await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 1001 }, bob)).statusCode).toBe(400);
    expect((await t.post('/api/account/weather/credentials', { provider: 'METEOMATICS', credential: { provider: 'METEOMATICS', username: 'bob_vmn', password: SECRET_PASSWORD }, dailyBudget: 501 }, bob)).statusCode).toBe(400);
    // Budget 2: the test call on saving used 1; one forecast fits; the next refresh is refused before any request.
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 2 }, bob);
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json().forecast.provider).toBe('OPENWEATHER');
    await t.post('/api/account/weather', { settings: { ...SETTINGS, location: { ...TRIORA, elevation: 780 } } }, bob); // a new cache entry
    const before = requests.length;
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'budget_reached' });
    expect((await t.post('/api/account/weather/credentials/test', { provider: 'OPENWEATHER' }, bob)).json()).toEqual({ error: 'weather_unavailable', reason: 'budget_reached' });
    expect(requests.length).toBe(before);
    // With fallback allowed, a keyless provider answers instead — labelled.
    await t.post('/api/account/weather', { settings: { ...SETTINGS, fallback: true, location: { ...TRIORA, elevation: 780 } } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toMatchObject({ forecast: { provider: 'OPEN_METEO' }, fellBackFrom: 'OPENWEATHER' });
  });

  it('counts Meteomatics’ two queries, keeps its password out of URLs and everything else, and builds days from its answer', async () => {
    const saved = await t.post('/api/account/weather/credentials', { provider: 'METEOMATICS', credential: { provider: 'METEOMATICS', username: 'bob_vmn', password: SECRET_PASSWORD }, dailyBudget: 10 }, bob);
    expect(saved.json().status).toMatchObject({ readable: true, usedToday: 2 });
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'METEOMATICS' } }, bob);
    const answer = (await t.get('/api/account/weather/forecast?days=2', bob)).json();
    expect(answer).toMatchObject({ forecast: { provider: 'METEOMATICS' }, horizon: 9 });
    expect(answer.forecast.days).toHaveLength(2);
    expect((await status(bob, 'METEOMATICS'))?.personal).toMatchObject({ usedToday: 4 });
    for (const url of requests) expect(url.href).not.toContain(SECRET_PASSWORD);
    expect(everythingSaid()).not.toContain(SECRET_PASSWORD);
  });

  it('never lets a broken commercial provider affect the built-in ones, and says when a key must be entered again', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 100 }, bob);
    openWeatherDown = true;
    await t.post('/api/account/weather', { settings: { ...SETTINGS, location: { ...TRIORA, elevation: 10 } } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'unavailable' });
    await t.post('/api/account/weather', { settings: { ...SETTINGS, provider: 'MET_NORWAY' } }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json().forecast.provider).toBe('MET_NORWAY');
    // A sealed value moved to another owner does not open (owner bound in): Carol's copy must be entered again.
    const carolId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'carol@example.org'").get() as { id: string }).id;
    t.database.sqlite.prepare("INSERT INTO weather_credentials (id, scope, user_id, provider, sealed, available_to_users, daily_budget, used_today, created_at, updated_at) SELECT 'c0ffee00-0000-4000-8000-000000000000', 'USER', ?, provider, sealed, 0, 10, 0, 0, 0 FROM weather_credentials").run(carolId);
    expect((await status(carol))?.personal).toMatchObject({ readable: false });
    await t.post('/api/account/weather', { settings: SETTINGS }, carol);
    expect((await t.get('/api/account/weather/forecast', carol)).json()).toEqual({ forecast: null, reason: 'needs_reentry' });
    expect(requests.filter((url) => url.searchParams.get('appid') === BOB_KEY && url.host === 'api.openweathermap.org')).toHaveLength(2);
  });

  it('refuses commercial providers the server admin did not allow — but always lets people delete their own key', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 100 }, bob);
    await t.post('/api/admin/weather', { enabled: true, allowed: ['OPEN_METEO', 'MET_NORWAY'], metContact: null }, t.admin);
    expect((await t.get('/api/account/weather', bob)).json().providers).toEqual(['OPEN_METEO', 'MET_NORWAY']);
    expect((await t.post('/api/account/weather/credentials/test', { provider: 'OPENWEATHER' }, bob)).statusCode).toBe(404);
    await t.post('/api/account/weather', { settings: SETTINGS }, bob);
    expect((await t.get('/api/account/weather/forecast', bob)).json()).toEqual({ forecast: null, reason: 'not_allowed' });
    expect((await t.post('/api/account/weather/credentials/delete', { provider: 'OPENWEATHER' }, bob)).statusCode).toBe(204);
  });

  it('limits credential tests per account (5 per 15 minutes), so nobody can drain a quota by hammering the button', async () => {
    await t.post('/api/account/weather/credentials', { provider: 'OPENWEATHER', credential: { provider: 'OPENWEATHER', apiKey: BOB_KEY }, dailyBudget: 100 }, bob);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) statuses.push((await t.post('/api/account/weather/credentials/test', { provider: 'OPENWEATHER' }, bob)).statusCode);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // Per account: Carol is not affected by Bob's attempts.
    expect((await t.post('/api/account/weather/credentials/test', { provider: 'OPENWEATHER' }, carol)).statusCode).toBe(404);
  });
});

