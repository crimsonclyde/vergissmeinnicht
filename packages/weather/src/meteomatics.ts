import { WeatherProviderError, type ForecastQuery, type WeatherProviderAdapter } from '@vergissmeinnicht/application';
import { conditionFromMeteomatics, type WeatherDay } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';
import { optional } from './open-meteo.ts';

/** The only host this adapter talks to (verified 2026-10-08). */
const API_ORIGIN = 'https://api.meteomatics.com';
/** The Basic account's horizon (10 days). */
export const METEOMATICS_DAYS = 10;
const CURRENT = 't_2m:C,weather_symbol_1h:idx,precip_1h:mm,wind_speed_10m:kmh';
const DAILY = 't_max_2m_24h:C,t_min_2m_24h:C,precip_24h:mm,weather_symbol_24h:idx';

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Local date and UTC offset of an instant at the place, e.g. `{ date: '2026-10-08', offset: '+02:00' }`. */
function localDay(at: Date, timeZone: string): { readonly date: string; readonly offset: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset' }).formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return { date: `${parts.year}-${parts.month}-${parts.day}`, offset };
}

/** `{ "<parameter>": [{ date, value }] }` from Meteomatics' JSON (`data[].coordinates[0].dates[]`). */
function series(body: unknown): Map<string, { readonly date: string; readonly value: number | undefined }[]> {
  const result = new Map<string, { date: string; value: number | undefined }[]>();
  if (!isRecord(body) || body.status !== 'OK') throw new WeatherProviderError('bad_response');
  for (const raw of array(body.data)) {
    if (!isRecord(raw) || typeof raw.parameter !== 'string') continue;
    const point = array(raw.coordinates)[0];
    if (!isRecord(point)) continue;
    // Meteomatics marks values it cannot provide as -999 (and similar): missing, never a temperature.
    const dates = array(point.dates).flatMap((entry) => (isRecord(entry) && typeof entry.date === 'string' ? [{ date: entry.date, value: ((value) => (value === undefined || value <= -666 ? undefined : value))(finite(entry.value)) }] : []));
    result.set(raw.parameter, dates);
  }
  return result;
}

/**
 * Meteomatics (19.4b) — optional, needs the person's or the server's username and password (HTTP Basic,
 * so nothing secret is in the URL). Two queries per forecast — current conditions and daily values — both
 * counted against the credential's budget (Basic account: 500 queries/day, non-commercial, 10 days).
 * Daily values are 24-hour aggregates ending at each local midnight. Rain probability is not requested
 * (not part of every account); it stays missing. No elevation parameter.
 */
export function createMeteomatics(options: { readonly fetch?: Fetch; readonly now?: () => Date } = {}): WeatherProviderAdapter {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const call = (path: string, query: ForecastQuery) => {
    if (query.credential?.provider !== 'METEOMATICS') throw new WeatherProviderError('needs_credentials');
    const basic = Buffer.from(`${query.credential.username}:${query.credential.password}`, 'utf8').toString('base64');
    return getJson(doFetch, new URL(`${API_ORIGIN}/${path}/${query.latitude},${query.longitude}/json`), { authorization: `Basic ${basic}` }, {
      classify: (status) => (status === 401 || status === 403 ? 'invalid_credentials' : status === 402 || status === 429 ? 'quota_exhausted' : status === 404 ? 'not_covered' : undefined),
    });
  };
  return {
    id: 'METEOMATICS',
    queriesPerForecast: 2,

    async forecast(query) {
      // The first 24-hour period ends at the coming local midnight; the times carry the place's offset.
      const today = localDay(now(), query.timeZone);
      const next = new Date(`${today.date}T00:00:00${today.offset}`);
      const start = new Date(next.getTime() + 86_400_000);
      const end = new Date(start.getTime() + (METEOMATICS_DAYS - 1) * 86_400_000);
      const iso = (at: Date) => at.toISOString().replace('.000Z', 'Z');
      const daily = series((await call(`${iso(start)}--${iso(end)}:P1D/${DAILY}`, query)).body);
      const current = series((await call(`now/${CURRENT}`, query)).body);

      const byDay = new Map<string, Record<string, number | undefined>>();
      for (const [parameter, values] of daily) {
        for (const { date, value } of values) {
          // A 24-hour value at midnight belongs to the day that just ended.
          const day = localDay(new Date(Date.parse(date) - 60_000), query.timeZone).date;
          byDay.set(day, { ...byDay.get(day), [parameter]: value });
        }
      }
      const days: WeatherDay[] = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({
          date,
          ...optional('max', round1(values['t_max_2m_24h:C'])),
          ...optional('min', round1(values['t_min_2m_24h:C'])),
          ...optional('precipitationSum', round1(values['precip_24h:mm'])),
          ...optional('condition', conditionFromMeteomatics(values['weather_symbol_24h:idx'])),
        }))
        .filter((day) => Object.keys(day).length > 1);
      if (days.length === 0) throw new WeatherProviderError('bad_response');
      const first = (parameter: string) => current.get(parameter)?.[0]?.value;
      const now_ = {
        ...optional('temperature', round1(first('t_2m:C'))),
        ...optional('condition', conditionFromMeteomatics(first('weather_symbol_1h:idx'))),
        ...optional('windSpeed', round1(first('wind_speed_10m:kmh'))),
        ...optional('precipitation', round1(first('precip_1h:mm'))),
      };
      return { kind: 'forecast', forecast: { provider: 'METEOMATICS', ...(Object.keys(now_).length > 0 ? { current: now_ } : {}), days } };
    },
  };
}
