import { DEFAULT_WEATHER_SETTINGS, type User, type UserId, type WeatherSettings } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_WEATHER, WeatherProviderError, type ForecastAnswer, type ServerWeatherSettings, type StoredWeatherCredential, type WeatherProviderAdapter } from '../ports/weather.ts';
import { NoForecastError, WeatherOffError, compareForecasts, createWeatherService, myForecast, saveMyWeather, type WeatherDeps } from './use-cases.ts';

const TRIORA = { name: 'Triora', latitude: 43.99, longitude: 7.77, timeZone: 'Europe/Rome', elevation: null };
const user = { id: 'u1' as UserId, status: 'ACTIVE', emailVerified: true, serverAdmin: false } as unknown as User;

function provider(id: WeatherProviderAdapter['id'], behave: () => Promise<ForecastAnswer>, calls: { n: number }): WeatherProviderAdapter {
  return {
    id,
    forecast: async () => {
      calls.n += 1;
      return behave();
    },
  };
}
const ok = (id: WeatherProviderAdapter['id']): ForecastAnswer => ({ kind: 'forecast', forecast: { provider: id, days: [{ date: '2026-10-08', max: 18 }] } });

function setup(options: { openMeteo?: () => Promise<ForecastAnswer>; met?: () => Promise<ForecastAnswer>; settings?: Partial<WeatherSettings>; server?: Partial<ServerWeatherSettings> } = {}) {
  let now = new Date('2026-10-08T10:00:00Z');
  const clock = { now: () => now };
  const calls = { openMeteo: { n: 0 }, met: { n: 0 } };
  const service = createWeatherService({
    providers: [provider('OPEN_METEO', options.openMeteo ?? (async () => ok('OPEN_METEO')), calls.openMeteo), provider('MET_NORWAY', options.met ?? (async () => ok('MET_NORWAY')), calls.met)],
    models: { coverage: async () => [] },
    geocoder: { search: async () => [] },
    clock,
  });
  let stored: WeatherSettings | undefined = { ...DEFAULT_WEATHER_SETTINGS, location: TRIORA, ...options.settings };
  const server: ServerWeatherSettings = { ...DEFAULT_SERVER_WEATHER, ...options.server };
  const deps: WeatherDeps = {
    weatherSettings: { find: async () => stored, save: async (_id, settings) => void (stored = settings) },
    serverWeather: { get: async () => server, save: async () => true },
    weather: service,
    credentials: { find: async () => undefined, list: async () => [], save: async () => true, remove: async () => true, consume: async () => true, recordTest: async () => undefined },
    secrets: { seal: (plain) => plain, open: (sealed) => sealed },
    clock,
  };
  return { deps, calls, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('weather forecasts (19.4)', () => {
  it('asks the provider once for everyone at the same moment and then serves the cache until it is stale', async () => {
    const { deps, calls, advance } = setup();
    const [a, b] = await Promise.all([myForecast(deps, { user }), myForecast(deps, { user })]);
    expect(calls.openMeteo.n).toBe(1);
    expect(a.forecast.provider).toBe('OPEN_METEO');
    expect(b.stale).toBe(false);
    advance(29 * 60_000);
    await myForecast(deps, { user });
    expect(calls.openMeteo.n).toBe(1);
    advance(2 * 60_000);
    await myForecast(deps, { user });
    expect(calls.openMeteo.n).toBe(2);
  });

  it('shows a cached copy labelled stale when the provider fails — but never one older than 6 hours', async () => {
    let fail = false;
    const { deps, advance } = setup({ openMeteo: async () => (fail ? Promise.reject(new WeatherProviderError('unavailable')) : ok('OPEN_METEO')), settings: { provider: 'OPEN_METEO' } });
    await myForecast(deps, { user });
    fail = true;
    advance(2 * 60 * 60_000);
    expect(await myForecast(deps, { user })).toMatchObject({ stale: true, fetchedAt: new Date('2026-10-08T10:00:00Z') });
    advance(5 * 60 * 60_000);
    await expect(myForecast(deps, { user })).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('Automatic tries Open-Meteo, then MET Norway, and says which one answered', async () => {
    const { deps, calls } = setup({ openMeteo: async () => Promise.reject(new WeatherProviderError('unavailable')) });
    expect(await myForecast(deps, { user })).toMatchObject({ forecast: { provider: 'MET_NORWAY' }, fellBackFrom: 'OPEN_METEO' });
    expect(calls.met.n).toBe(1);
  });

  it('never silently replaces an explicitly chosen provider — only when the person allowed fallback, and labelled (W4)', async () => {
    const failing = async () => Promise.reject(new WeatherProviderError('rate_limited'));
    const strict = setup({ met: failing, settings: { provider: 'MET_NORWAY', fallback: false } });
    await expect(myForecast(strict.deps, { user })).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(strict.calls.openMeteo.n).toBe(0);
    const lenient = setup({ met: failing, settings: { provider: 'MET_NORWAY', fallback: true } });
    expect(await myForecast(lenient.deps, { user })).toMatchObject({ forecast: { provider: 'OPEN_METEO' }, fellBackFrom: 'MET_NORWAY' });
  });

  it('uses no provider the server admin did not allow, and nothing at all while weather is switched off (W1)', async () => {
    const limited = setup({ server: { allowed: ['MET_NORWAY'] } });
    expect((await myForecast(limited.deps, { user })).forecast.provider).toBe('MET_NORWAY');
    expect(limited.calls.openMeteo.n).toBe(0);
    const off = setup({ server: { enabled: false } });
    await expect(myForecast(off.deps, { user })).rejects.toBeInstanceOf(WeatherOffError);
    await expect(saveMyWeather(off.deps, { user, settings: DEFAULT_WEATHER_SETTINGS })).rejects.toBeInstanceOf(WeatherOffError);
    expect(off.calls.openMeteo.n + off.calls.met.n).toBe(0);
  });

  it('asks nothing without a location; a credential provider without an adapter is not used (19.4b)', async () => {
    const none = setup({ settings: { location: null } });
    await expect(myForecast(none.deps, { user })).rejects.toEqual(new NoForecastError('no_location'));
    const keyed = setup({ settings: { provider: 'OPENWEATHER' } });
    await expect(myForecast(keyed.deps, { user })).rejects.toMatchObject({ reason: 'not_allowed' });
    expect(keyed.calls.openMeteo.n + keyed.calls.met.n).toBe(0);
  });

  it('keeps one cache entry per model and per place', async () => {
    const { deps, calls } = setup({ settings: { provider: 'OPEN_METEO', model: 'icon_d2' } });
    await myForecast(deps, { user });
    await deps.weatherSettings.save(user.id, { ...DEFAULT_WEATHER_SETTINGS, location: TRIORA, provider: 'OPEN_METEO', model: 'italia_meteo_arpae_icon_2i' }, new Date());
    await myForecast(deps, { user });
    await deps.weatherSettings.save(user.id, { ...DEFAULT_WEATHER_SETTINGS, location: { ...TRIORA, elevation: 780 }, provider: 'OPEN_METEO', model: 'italia_meteo_arpae_icon_2i' }, new Date());
    await myForecast(deps, { user });
    expect(calls.openMeteo.n).toBe(3);
  });
});

describe('forecast comparison with a paid source (19.4c)', () => {
  it('shows an older cached paid forecast with its time and why it was not refreshed, when the budget is used up', async () => {
    let now = new Date('2026-10-08T10:00:00Z');
    const clock = { now: () => now };
    const calls = { n: 0 };
    const paid: WeatherProviderAdapter = { id: 'OPENWEATHER', queriesPerForecast: 1, forecast: async () => (calls.n++, ok('OPENWEATHER')) };
    const service = createWeatherService({ providers: [paid, provider('OPEN_METEO', async () => ok('OPEN_METEO'), { n: 0 })], models: { coverage: async () => [] }, geocoder: { search: async () => [] }, clock });
    let budgetLeft = 1;
    const stored: StoredWeatherCredential = { id: 'c1', scope: { kind: 'USER', userId: user.id }, provider: 'OPENWEATHER', sealed: JSON.stringify({ provider: 'OPENWEATHER', apiKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), availableToUsers: false, dailyBudget: 1, usedToday: 0, usageDay: null, lastTest: null, updatedAt: now };
    const deps: WeatherDeps = {
      weatherSettings: { find: async () => ({ ...DEFAULT_WEATHER_SETTINGS, location: TRIORA }), save: async () => undefined },
      serverWeather: { get: async () => DEFAULT_SERVER_WEATHER, save: async () => true },
      weather: service,
      credentials: { find: async (scope) => (scope.kind === 'USER' ? stored : undefined), list: async () => [stored], save: async () => true, remove: async () => true, consume: async () => (budgetLeft-- > 0), recordTest: async () => undefined },
      secrets: { seal: (plain) => plain, open: (sealed) => sealed },
      clock,
    };
    const first = await compareForecasts(deps, { user, sources: [{ provider: 'OPENWEATHER' }], fetchPaid: true });
    expect(first.results[0]).toMatchObject({ state: 'fresh' });
    now = new Date('2026-10-08T11:00:00Z'); // older than fresh (30 min), younger than 6 h
    const without = await compareForecasts(deps, { user, sources: [{ provider: 'OPENWEATHER' }, { provider: 'OPEN_METEO' }], fetchPaid: false });
    expect(without.results[0]).toMatchObject({ state: 'cached', refreshFailed: null, fetchedAt: new Date('2026-10-08T10:00:00Z') });
    expect(calls.n).toBe(1);
    const refused = await compareForecasts(deps, { user, sources: [{ provider: 'OPENWEATHER' }, { provider: 'OPEN_METEO' }], fetchPaid: true });
    expect(refused.results[0]).toMatchObject({ state: 'cached', refreshFailed: 'budget_reached' });
    expect(refused.results[1]).toMatchObject({ state: 'fresh' });
    expect(calls.n).toBe(1);
  });
});
