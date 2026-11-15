import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WeatherProviderError } from '@vergissmeinnicht/application';
import { describe, expect, it } from 'vitest';
import { createGazetteWeatherSources, MIN_HOURS_PER_DAY, parseAllertaLiguria } from './gazette-sources.ts';

/** Real answers recorded 2026-11-15 (see fixtures/README.md): tests never reach a provider. */
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const TRIORA = { latitude: 43.99, longitude: 7.76, elevation: 780, timeZone: 'Europe/Rome' };
const GOGGENHOFEN = { latitude: 48.22, longitude: 11.04, elevation: 520, timeZone: 'Europe/Berlin' };
const NOW = new Date('2026-11-15T07:00:00Z');

function sources(answer: (url: URL) => Response, seen: URL[] = []) {
  return createGazetteWeatherSources({
    fetch: (async (input: string | URL | Request) => { const url = new URL(input instanceof Request ? input.url : String(input)); seen.push(url); return answer(url); }) as typeof fetch,
    userAgent: async () => 'VergissMeinNicht/test (+https://github.com/crimsonclyde/vergissmeinnicht)',
    now: () => NOW,
  });
}
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });
async function reason(promise: Promise<unknown>) { try { await promise; } catch (error) { return error instanceof WeatherProviderError ? error.reason : 'other'; } return 'none'; }

describe('Daily Planet weather sources (43.7)', () => {
  it('reads several Open-Meteo models in one request, each with only its own days', async () => {
    const seen: URL[] = [];
    const result = await sources(() => json(fixture('gazette-open-meteo-triora.json')), seen).openMeteoModels(TRIORA, ['italia_meteo_arpae_icon_2i', 'ecmwf_ifs025', 'icon_eu'], 7);
    expect(seen[0]?.host).toBe('api.open-meteo.com');
    expect(seen[0]?.searchParams.get('models')).toBe('italia_meteo_arpae_icon_2i,ecmwf_ifs025,icon_eu');
    expect(seen[0]?.searchParams.get('elevation')).toBe('780');
    // ICON-2I covers about three days: nothing after is filled in from another model.
    expect(result['italia_meteo_arpae_icon_2i']?.map(d => d.date)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
    expect(result['ecmwf_ifs025']).toHaveLength(7);
    expect(result['italia_meteo_arpae_icon_2i']?.[0]).toMatchObject({ date: '2026-11-15', high: 9.8, low: 6.4, condition: 'RAIN' });
    expect(result['ecmwf_ifs025']?.[0]?.gustKmh).toBeTypeOf('number');
  });

  it('reports Open-Meteo\'s daily limit as rate limited, not as an empty forecast', async () => {
    expect(await reason(sources(() => json('{"reason":"Daily API request limit exceeded. Please try again tomorrow.","error":true}', 429)).openMeteoModels(TRIORA, ['ecmwf_ifs025'], 7))).toBe('rate_limited');
    expect(await reason(sources(() => { throw new TypeError('network'); }).openMeteoModels(TRIORA, ['ecmwf_ifs025'], 7))).toBe('unavailable');
  });

  it('builds MOSMIX days from the forecast station only, in the place\'s time zone', async () => {
    const seen: URL[] = [];
    const { station, days } = await sources(() => json(fixture('gazette-brightsky-mosmix.json')), seen).mosmix(GOGGENHOFEN, '2026-11-15', 7);
    expect(seen[0]?.host).toBe('api.brightsky.dev');
    expect(seen[0]?.searchParams.get('tz')).toBe('Europe/Berlin');
    expect(station).toMatchObject({ name: 'MERING (BAUHOF)', distanceM: 7125 });
    expect(days.length).toBeGreaterThanOrEqual(5);
    for (const day of days) { expect(day.high).toBeTypeOf('number'); expect(day.low as number).toBeLessThanOrEqual(day.high as number); }
  });

  it('reads station observations for verification and needs most hours of the day', async () => {
    const day = await sources(() => json(fixture('gazette-brightsky-observations.json'))).dwdObservations(GOGGENHOFEN, '2026-11-13');
    expect(day).toMatchObject({ date: '2026-11-13', high: 5.8, low: -0.7, station: { name: 'Mering (Bauhof)', distanceM: 7316, elevationM: 508 } });
    expect(day?.hours).toBeGreaterThanOrEqual(MIN_HOURS_PER_DAY);
    const sparse = JSON.parse(fixture('gazette-brightsky-observations.json')) as { weather: unknown[] };
    expect(await sources(() => json(JSON.stringify({ ...sparse, weather: sparse.weather.slice(0, 10) }))).dwdObservations(GOGGENHOFEN, '2026-11-13')).toBeNull();
  });

  it('maps official DWD warnings to levels and drops expired ones', async () => {
    const warnings = await sources(() => json(fixture('gazette-brightsky-alerts.json'))).dwdWarnings(GOGGENHOFEN);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every(w => w.source === 'DWD' && w.level === 'yellow')).toBe(true);
    expect(warnings.map(w => w.text)).toContain('Official WARNING of FOG');
    expect(warnings.find(w => w.text.includes('FROST'))?.kind).toBe('frost');
    const later = createGazetteWeatherSources({ fetch: (async () => json(fixture('gazette-brightsky-alerts.json'))) as unknown as typeof fetch, userAgent: async () => 'x', now: () => new Date('2026-11-20T00:00:00Z') });
    expect(await later.dwdWarnings(GOGGENHOFEN)).toEqual([]);
  });

  it('takes Meteoalarm awareness for Liguria only, yellow and above', async () => {
    const warnings = await sources(() => json(fixture('gazette-meteoalarm-italy.json'))).meteoalarmItaly('Liguria');
    expect(warnings.map(w => `${w.level} ${w.text}`)).toContain('yellow Yellow Wind Warning (Liguria)');
    expect(warnings.every(w => w.level !== 'info' && w.text.endsWith('(Liguria)'))).toBe(true);
    expect(warnings[0]?.kind).toBe('wind');
  });

  it('reads the AllertaLiguria level of the zone and refuses a page it does not recognise', async () => {
    const warnings = parseAllertaLiguria(fixture('gazette-allerta-liguria.html'), 'A');
    expect(warnings[0]).toMatchObject({ level: 'info', source: 'AllertaLiguria', text: 'No civil protection alert for zone A (message 14/11/2026 10:45).' });
    expect(warnings[1]?.text).toContain('Rischio meteo per vento');
    const yellow = fixture('gazette-allerta-liguria.html').replace('V_V_V_V_V.png', 'G_V_V_V_V.png');
    expect(parseAllertaLiguria(yellow, 'A')[0]?.level).toBe('yellow');
    expect(parseAllertaLiguria(yellow, 'B')[0]?.level).toBe('info');
    expect(() => parseAllertaLiguria('<html>maintenance</html>', 'A')).toThrow(WeatherProviderError);
    const seen: URL[] = [];
    await sources(() => new Response(fixture('gazette-allerta-liguria.html'), { status: 200, headers: { 'content-type': 'text/html' } }), seen).allertaLiguria('A');
    expect(seen[0]?.href).toBe('https://allertaliguria.regione.liguria.it/');
  });
});
