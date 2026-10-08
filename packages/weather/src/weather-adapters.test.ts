import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WeatherProviderError } from '@vergissmeinnicht/application';
import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES } from './http.ts';
import { createMetNorway, metUserAgent } from './met-norway.ts';
import { createOpenMeteo } from './open-meteo.ts';

/** Real answers recorded 2026-10-08 for Triora (Liguria): tests never reach a provider. */
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const TRIORA = { latitude: 43.99, longitude: 7.77, elevation: null, timeZone: 'Europe/Rome' };

interface Seen {
  readonly url: URL;
  readonly init: RequestInit | undefined;
}

function fakeFetch(answer: (url: URL) => Response, seen: Seen[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push({ url, init });
    return answer(url);
  }) as typeof fetch;
}
const json = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } });

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WeatherProviderError) return error.reason;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('Open-Meteo', () => {
  it('asks only its fixed host, over HTTPS, without following redirects, and normalises the answer', async () => {
    const seen: Seen[] = [];
    const provider = createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-best-match.json')), seen) });
    const answer = await provider.forecast({ ...TRIORA, model: 'best_match' });
    expect(seen[0]?.url.origin).toBe('https://api.open-meteo.com');
    expect(seen[0]?.init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(Object.fromEntries(seen[0]?.url.searchParams ?? [])).toMatchObject({ latitude: '43.99', longitude: '7.77', timezone: 'Europe/Rome', models: 'best_match', forecast_days: '3' });
    expect(seen[0]?.url.searchParams.has('elevation')).toBe(false);
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    expect(answer.forecast).toEqual({
      provider: 'OPEN_METEO',
      model: 'best_match',
      current: { temperature: 16.2, condition: 'CLOUDY', windSpeed: 3.9, precipitation: 0 },
      days: [
        { date: '2026-10-08', min: 12.8, max: 19.1, precipitationSum: 3.4, precipitationProbabilityMax: 70, windSpeedMax: 7.2, condition: 'SHOWERS' },
        { date: '2026-10-09', min: 10.1, max: 18.4, precipitationSum: 0, precipitationProbabilityMax: 70, windSpeedMax: 11.5, condition: 'CLOUDY' },
        { date: '2026-10-10', min: 10.2, max: 17.8, precipitationSum: 0, precipitationProbabilityMax: 3, windSpeedMax: 8, condition: 'CLOUDY' },
      ],
    });
  });

  it('keeps a value the model does not have missing — ICON-2I has no rain probability — and sends the elevation', async () => {
    const seen: Seen[] = [];
    const provider = createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-icon-2i.json')), seen) });
    const answer = await provider.forecast({ ...TRIORA, elevation: 780, model: 'italia_meteo_arpae_icon_2i' });
    expect(seen[0]?.url.searchParams.get('elevation')).toBe('780');
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    expect(answer.forecast.model).toBe('italia_meteo_arpae_icon_2i');
    for (const day of answer.forecast.days) expect(day).not.toHaveProperty('precipitationProbabilityMax');
    expect(answer.forecast.days[0]).toMatchObject({ min: 12.1, max: 17.9, precipitationSum: 11.9 });
  });

  it('treats a model with no values for the place as not covering it', async () => {
    const empty = JSON.stringify({ daily: { time: ['2026-10-08'], temperature_2m_max: [null], temperature_2m_min: [null], weather_code: [null] } });
    expect(await reason(createOpenMeteo({ fetch: fakeFetch(() => json(empty)) }).forecast({ ...TRIORA, model: 'metno_nordic' }))).toBe('not_covered');
  });

  it('finds which models cover a place, how many days they forecast and what they lack (W2)', async () => {
    const seen: Seen[] = [];
    const provider = createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-coverage.json')), seen) });
    const models = await provider.coverage(TRIORA, ['italia_meteo_arpae_icon_2i', 'icon_d2', 'meteofrance_arome_france_hd', 'metno_nordic', 'ecmwf_ifs025']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.searchParams.get('models')).toBe('italia_meteo_arpae_icon_2i,icon_d2,meteofrance_arome_france_hd,metno_nordic,ecmwf_ifs025');
    const of = (id: string) => models.find((model) => model.model === id);
    expect(of('italia_meteo_arpae_icon_2i')).toMatchObject({ days: 3, hasCondition: true, hasPrecipitationProbability: false });
    expect(of('icon_d2')?.days).toBe(2);
    expect(of('meteofrance_arome_france_hd')).toMatchObject({ hasCondition: false });
    expect(of('metno_nordic')?.days).toBe(0);
    expect(of('ecmwf_ifs025')?.days).toBeGreaterThanOrEqual(10);
  });

  it('searches places on its geocoding host and keeps only well-formed results', async () => {
    const seen: Seen[] = [];
    const provider = createOpenMeteo({ fetch: fakeFetch(() => json(fixture('open-meteo-geocoding.json')), seen) });
    expect(await provider.search('Triora', 'en')).toEqual([{ name: 'Triora', context: 'Liguria, Italy', latitude: 43.99, longitude: 7.76, elevation: 780, timeZone: 'Europe/Rome' }]);
    expect(seen[0]?.url.origin).toBe('https://geocoding-api.open-meteo.com');
    const hostile = JSON.stringify({ results: [{ name: 'Evil‮gnp.exe', latitude: 1, longitude: 1, timezone: 'UTC' }, { name: 'Far', latitude: 400, longitude: 1, timezone: 'UTC' }, { name: 'Zone', latitude: 1, longitude: 1, timezone: '../../etc' }] });
    expect(await createOpenMeteo({ fetch: fakeFetch(() => json(hostile)) }).search('x y', 'en')).toEqual([]);
  });

  it('maps failures to stable reasons and refuses oversized answers', async () => {
    const forecast = (response: () => Response) => createOpenMeteo({ fetch: fakeFetch(response) }).forecast(TRIORA);
    expect(await reason(forecast(() => new Response('', { status: 429 })))).toBe('rate_limited');
    expect(await reason(forecast(() => new Response('', { status: 503 })))).toBe('unavailable');
    expect(await reason(forecast(() => json('not json')))).toBe('bad_response');
    expect(await reason(forecast(() => json(`"${'x'.repeat(MAX_RESPONSE_BYTES + 10)}"`)))).toBe('bad_response');
    const offline = createOpenMeteo({ fetch: (async () => Promise.reject(new TypeError('offline'))) as typeof fetch });
    expect(await reason(offline.forecast(TRIORA))).toBe('unavailable');
  });
});

describe('MET Norway', () => {
  const userAgent = async () => metUserAgent('weather@example.org');

  it('identifies VMN with a contact, sends at most 2 decimals and the altitude, and honours Expires and Last-Modified', async () => {
    const seen: Seen[] = [];
    const headers = { expires: 'Thu, 08 Oct 2026 08:55:53 GMT', 'last-modified': 'Thu, 08 Oct 2026 08:24:20 GMT' };
    const provider = createMetNorway({ fetch: fakeFetch(() => json(fixture('met-norway-compact.json'), headers), seen), userAgent });
    const answer = await provider.forecast({ ...TRIORA, latitude: 43.99, elevation: 780 });
    expect(seen[0]?.url.origin + (seen[0]?.url.pathname ?? '')).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact');
    expect(Object.fromEntries(seen[0]?.url.searchParams ?? [])).toEqual({ lat: '43.99', lon: '7.77', altitude: '780' });
    expect((seen[0]?.init?.headers as Record<string, string>)['user-agent']).toBe('VergissMeinNicht (+https://github.com/crimsonclyde/vergissmeinnicht; weather@example.org)');
    expect(seen[0]?.init).toMatchObject({ redirect: 'error' });
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    expect(answer.expiresAt?.toISOString()).toBe('2026-10-08T08:55:53.000Z');
    expect(answer.lastModified).toBe(headers['last-modified']);
    expect(answer.forecast).toMatchObject({ provider: 'MET_NORWAY', issuedAt: '2026-10-08T08:22:17.000Z', current: { temperature: 14.9, condition: 'CLEAR' } });
    // Days in the place's time zone; the first one only from now on (partial); no rain probability anywhere.
    const [today, tomorrow] = answer.forecast.days;
    expect(today).toMatchObject({ date: '2026-10-08', partial: true });
    expect(tomorrow?.date).toBe('2026-10-09');
    expect(tomorrow).not.toHaveProperty('partial');
    for (const day of answer.forecast.days) {
      expect(day).not.toHaveProperty('precipitationProbabilityMax');
      expect(day.min).toBeLessThanOrEqual(day.max ?? Number.NaN);
    }
    // Revalidation: the previous Last-Modified goes back; 304 keeps the cached forecast.
    const revalidate: Seen[] = [];
    const again = await createMetNorway({ fetch: fakeFetch(() => new Response(null, { status: 304, headers: { expires: 'Thu, 08 Oct 2026 09:30:00 GMT' } }), revalidate), userAgent }).forecast({
      ...TRIORA,
      ifModifiedSince: headers['last-modified'],
    });
    expect((revalidate[0]?.init?.headers as Record<string, string>)['if-modified-since']).toBe(headers['last-modified']);
    expect(again).toEqual({ kind: 'not_modified', expiresAt: new Date('2026-10-08T09:30:00Z') });
  });

  it('counts each hour of rain once: hourly periods first, 6-hour periods where no hourly ones exist', async () => {
    const at = (iso: string, hour1: number | null, hour6: number | null) => ({
      time: iso,
      data: { instant: { details: { air_temperature: 10, wind_speed: 1 } }, ...(hour1 === null ? {} : { next_1_hours: { summary: { symbol_code: 'rain' }, details: { precipitation_amount: hour1 } } }), ...(hour6 === null ? {} : { next_6_hours: { summary: { symbol_code: 'rain' }, details: { precipitation_amount: hour6 } } }) },
    });
    const body = JSON.stringify({ properties: { meta: {}, timeseries: [at('2026-10-09T00:00:00Z', 1, 9), at('2026-10-09T01:00:00Z', 2, 9), at('2026-10-09T02:00:00Z', null, 6), at('2026-10-09T08:00:00Z', null, 4)] } });
    const answer = await createMetNorway({ fetch: fakeFetch(() => json(body)), userAgent }).forecast({ ...TRIORA, timeZone: 'UTC' });
    if (answer.kind !== 'forecast') throw new Error('expected a forecast');
    expect(answer.forecast.days[0]?.precipitationSum).toBe(13);
  });

  it('slows down on 429 and never treats an error answer as a forecast', async () => {
    expect(await reason(createMetNorway({ fetch: fakeFetch(() => new Response('', { status: 429 })), userAgent }).forecast(TRIORA))).toBe('rate_limited');
    expect(await reason(createMetNorway({ fetch: fakeFetch(() => new Response('', { status: 403 })), userAgent }).forecast(TRIORA))).toBe('unavailable');
    expect(await reason(createMetNorway({ fetch: fakeFetch(() => json('{"properties":{"timeseries":[]}}')), userAgent }).forecast(TRIORA))).toBe('bad_response');
  });

  it('names the project without a contact when the server admin set none', () => {
    expect(metUserAgent(null)).toBe('VergissMeinNicht (+https://github.com/crimsonclyde/vergissmeinnicht)');
  });
});
