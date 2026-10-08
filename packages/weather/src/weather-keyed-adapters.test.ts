import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WeatherProviderError } from '@vergissmeinnicht/application';
import { describe, expect, it } from 'vitest';
import { createMeteomatics } from './meteomatics.ts';
import { createMetNorway, metUserAgent } from './met-norway.ts';
import { createOpenMeteo } from './open-meteo.ts';
import { createOpenWeather } from './openweather.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const TRIORA = { latitude: 43.99, longitude: 7.77, elevation: null, timeZone: 'Europe/Rome' };
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const json = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

interface Seen {
  readonly url: URL;
  readonly headers: Record<string, string>;
}
function fakeFetch(answer: (url: URL) => Response, seen: Seen[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return answer(url);
  }) as typeof fetch;
}
async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WeatherProviderError) return error.reason;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('OpenWeather One Call 3.0 (19.4b; documented format, no live account)', () => {
  const credential = { provider: 'OPENWEATHER' as const, apiKey: KEY };

  it('asks only its fixed URL, once, metric, without minutely/hourly/alerts, and normalises 8 days', async () => {
    const seen: Seen[] = [];
    const answer = await createOpenWeather({ fetch: fakeFetch(() => json(fixture('openweather-onecall.json')), seen) }).forecast({ ...TRIORA, credential });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.origin + (seen[0]?.url.pathname ?? '')).toBe('https://api.openweathermap.org/data/3.0/onecall');
    expect(Object.fromEntries(seen[0]?.url.searchParams ?? [])).toEqual({ lat: '43.99', lon: '7.77', units: 'metric', exclude: 'minutely,hourly,alerts', appid: KEY });
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    const { forecast } = answer;
    expect(forecast.days).toHaveLength(8);
    expect(forecast.current).toEqual({ temperature: 15.4, condition: 'RAIN', windSpeed: 7.6, precipitation: 0.3 });
    expect(forecast.days[0]).toEqual({ date: '2026-10-08', min: 11.8, max: 18.2, precipitationSum: 6.4, precipitationProbabilityMax: 82, windSpeedMax: 16.2, condition: 'RAIN' });
    // No rain field at all on a dry day: missing, not 0. Rain and snow together on a mixed day.
    expect(forecast.days[1]).not.toHaveProperty('precipitationSum');
    expect(forecast.days[2]).toMatchObject({ precipitationSum: 1.6, condition: 'SLEET' });
    expect(forecast.days.map((day) => day.condition)).toEqual(['RAIN', 'PARTLY_CLOUDY', 'SLEET', 'CLEAR', 'CLEAR', 'CLOUDY', 'THUNDER', 'FOG']);
  });

  it('refuses to run without its credential and maps a bad key and an exhausted quota to stable reasons', async () => {
    const seen: Seen[] = [];
    expect(await reason(createOpenWeather({ fetch: fakeFetch(() => json('{}'), seen) }).forecast(TRIORA))).toBe('needs_credentials');
    expect(seen).toEqual([]);
    const answer = (status: number) => createOpenWeather({ fetch: fakeFetch(() => new Response('{"cod":401,"message":"Invalid API key ' + KEY + '"}', { status })) }).forecast({ ...TRIORA, credential });
    expect(await reason(answer(401))).toBe('invalid_credentials');
    expect(await reason(answer(429))).toBe('quota_exhausted');
    expect(await reason(answer(500))).toBe('unavailable');
    // The error never carries the provider's text (which may repeat the key).
    const error = await answer(401).catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});

describe('Meteomatics (19.4b; documented format, no live account)', () => {
  const credential = { provider: 'METEOMATICS' as const, username: 'household_vmn', password: 'S3cret!pass' };
  const now = () => new Date('2026-10-08T08:30:00Z');

  it('signs in with HTTP Basic (nothing secret in the URL), asks two queries and builds 9 days from 24-hour values', async () => {
    const seen: Seen[] = [];
    const provider = createMeteomatics({ now, fetch: fakeFetch((url) => json(fixture(url.pathname.startsWith('/now/') ? 'meteomatics-current.json' : 'meteomatics-daily.json')), seen) });
    expect(provider.queriesPerForecast).toBe(2);
    const answer = await provider.forecast({ ...TRIORA, credential });
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request.url.origin).toBe('https://api.meteomatics.com');
      expect(request.url.href).not.toContain('S3cret');
      expect(request.url.href).not.toContain('household_vmn');
      expect(request.headers.authorization).toBe(`Basic ${Buffer.from('household_vmn:S3cret!pass').toString('base64')}`);
    }
    // The first 24-hour period ends at the coming local midnight (22:00 UTC in Rome in October).
    expect(seen[0]?.url.pathname).toBe('/2026-10-08T22:00:00Z--2026-10-17T22:00:00Z:P1D/t_max_2m_24h:C,t_min_2m_24h:C,precip_24h:mm,weather_symbol_24h:idx/43.99,7.77/json');
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    const { forecast } = answer;
    expect(forecast.current).toEqual({ temperature: 15.9, condition: 'SHOWERS', windSpeed: 9, precipitation: 0.4 });
    // The tenth value is Meteomatics' "no value" (-999): that day is left out, not shown as -999 °C.
    expect(forecast.days).toHaveLength(9);
    expect(forecast.days[0]).toEqual({ date: '2026-10-08', max: 18.4, min: 12, precipitationSum: 7.1, condition: 'RAIN' });
    expect(forecast.days.at(-1)?.date).toBe('2026-10-16');
    for (const day of forecast.days) expect(day).not.toHaveProperty('precipitationProbabilityMax');
  });

  it('maps bad credentials, payment-required and licence limits to stable reasons', async () => {
    const answer = (status: number) => createMeteomatics({ now, fetch: fakeFetch(() => new Response('denied', { status })) }).forecast({ ...TRIORA, credential });
    expect(await reason(answer(401))).toBe('invalid_credentials');
    expect(await reason(answer(403))).toBe('invalid_credentials');
    expect(await reason(answer(402))).toBe('quota_exhausted');
    expect(await reason(answer(429))).toBe('quota_exhausted');
    expect(await reason(createMeteomatics({ now, fetch: fakeFetch(() => json('{}')) }).forecast(TRIORA))).toBe('needs_credentials');
  });
});

describe('forecast length follows the provider and model (19.4b)', () => {
  it('keeps every day a model offers — 16 for the default blend, 3 for ICON-2I — and invents none', async () => {
    const blend = await createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-best-match-16.json'))) }).forecast({ ...TRIORA, model: 'best_match' });
    const icon = await createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-icon-2i-16.json'))) }).forecast({ ...TRIORA, model: 'italia_meteo_arpae_icon_2i' });
    if (blend.kind !== 'forecast' || icon.kind !== 'forecast') throw new Error('expected forecasts');
    expect(blend.forecast.days).toHaveLength(16);
    expect(icon.forecast.days).toHaveLength(3);
  });

  it('asks Open-Meteo for its full horizon once, so Today and the detailed view share one cached answer', async () => {
    const seen: Seen[] = [];
    await createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-best-match-16.json')), seen) }).forecast(TRIORA);
    expect(seen[0]?.url.searchParams.get('forecast_days')).toBe('16');
  });

  it('keeps every day MET Norway gives', async () => {
    const answer = await createMetNorway({ fetch: fakeFetch(() => json(fixture('met-norway-compact.json'))), userAgent: async () => metUserAgent(null) }).forecast(TRIORA);
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    expect(answer.forecast.days.length).toBeGreaterThanOrEqual(9);
    // Days built from 6-hourly values cover the whole day: only today is "rest of the day".
    expect(answer.forecast.days.filter((day) => day.partial === true).map((day) => day.date)).toEqual(['2026-10-08']);
  });
});
