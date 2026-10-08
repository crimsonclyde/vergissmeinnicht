import { WeatherProviderError, type WeatherProviderAdapter } from '@vergissmeinnicht/application';
import { conditionFromMetSymbol, type WeatherCondition, type WeatherDay } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';
import { optional } from './open-meteo.ts';

/** The only URL this adapter talks to (Locationforecast 2.0, verified 2026-10-08). */
const COMPACT_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const PROJECT = 'https://github.com/crimsonclyde/vergissmeinnicht';
const MS_TO_KMH = 3.6;

/**
 * MET Norway's terms (W6): every request identifies the application with a contact — VMN's project page,
 * plus the server admin's address when one is set.
 */
export function metUserAgent(contact: string | null): string {
  // No version: the server does not know its release number at run time (MET makes the version optional).
  return `VergissMeinNicht (+${PROJECT}${contact === null ? '' : `; ${contact}`})`;
}

interface Slot {
  readonly at: Date;
  readonly temperature?: number;
  readonly windSpeed?: number;
  readonly hour1?: { readonly symbol?: string; readonly precipitation?: number };
  readonly hour6?: { readonly symbol?: string; readonly precipitation?: number };
  readonly hour12?: { readonly symbol?: string };
}

const period = (value: unknown): { symbol?: string; precipitation?: number } | undefined => {
  if (!isRecord(value)) return undefined;
  const summary = isRecord(value.summary) ? value.summary : {};
  const details = isRecord(value.details) ? value.details : {};
  return { ...optional('symbol', typeof summary.symbol_code === 'string' ? summary.symbol_code.slice(0, 64) : undefined), ...optional('precipitation', finite(details.precipitation_amount)) };
};

/** Local calendar date and hour of an instant at the location. */
function localParts(at: Date, timeZone: string): { readonly date: string; readonly hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * MET Norway Locationforecast (19.4): global, no key; cached per its `Expires`, revalidated with
 * `If-Modified-Since`; at most 4 decimals (VMN sends 2); `altitude` when the person set an elevation.
 * MET gives instants and 1/6/12-hour periods in UTC — days are built from them in the place's time zone:
 * min/max from the instants, rain from non-overlapping periods, the condition from the daytime period.
 * A day the data covers only partly (the rest of today) is marked `partial`. No rain probability.
 */
export function createMetNorway(options: { readonly fetch?: Fetch; readonly userAgent: () => Promise<string> }): WeatherProviderAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'MET_NORWAY',

    async forecast(query) {
      const url = new URL(COMPACT_URL);
      url.searchParams.set('lat', query.latitude.toFixed(2));
      url.searchParams.set('lon', query.longitude.toFixed(2));
      if (query.elevation !== null) url.searchParams.set('altitude', String(query.elevation));
      const headers: Record<string, string> = { 'user-agent': await options.userAgent() };
      if (query.ifModifiedSince !== undefined) headers['if-modified-since'] = query.ifModifiedSince;
      const response = await getJson(doFetch, url, headers);
      const expires = Date.parse(response.headers.get('expires') ?? '');
      const expiresAt = Number.isNaN(expires) ? undefined : new Date(expires);
      if (response.status === 304) return { kind: 'not_modified', ...optional('expiresAt', expiresAt) };
      const body = response.body;
      if (!isRecord(body) || !isRecord(body.properties)) throw new WeatherProviderError('bad_response');
      const properties = body.properties;
      const slots: Slot[] = (Array.isArray(properties.timeseries) ? properties.timeseries : []).flatMap((raw): Slot[] => {
        if (!isRecord(raw) || typeof raw.time !== 'string' || !isRecord(raw.data)) return [];
        const at = new Date(raw.time);
        if (Number.isNaN(at.getTime())) return [];
        const data = raw.data;
        const instant = isRecord(data.instant) && isRecord(data.instant.details) ? data.instant.details : {};
        const wind = finite(instant.wind_speed);
        return [
          {
            at,
            ...optional('temperature', finite(instant.air_temperature)),
            ...optional('windSpeed', wind === undefined ? undefined : wind * MS_TO_KMH),
            ...optional('hour1', period(data.next_1_hours)),
            ...optional('hour6', period(data.next_6_hours)),
            ...optional('hour12', period(data.next_12_hours)),
          },
        ];
      });
      slots.sort((a, b) => a.at.getTime() - b.at.getTime());
      const first = slots[0];
      if (first === undefined) throw new WeatherProviderError('bad_response');

      const byDay = new Map<string, { slot: Slot; hour: number }[]>();
      for (const slot of slots) {
        const { date, hour } = localParts(slot.at, query.timeZone);
        byDay.set(date, [...(byDay.get(date) ?? []), { slot, hour }]);
      }
      // Rain: each hour counted once — the 1-hour period where there is one, else the 6-hour period.
      const rain = new Map<string, number>();
      let coveredUntil = 0;
      for (const slot of slots) {
        if (slot.at.getTime() < coveredUntil) continue;
        const use = slot.hour1?.precipitation !== undefined ? { amount: slot.hour1.precipitation, hours: 1 } : slot.hour6?.precipitation !== undefined ? { amount: slot.hour6.precipitation, hours: 6 } : undefined;
        if (use === undefined) continue;
        const { date } = localParts(slot.at, query.timeZone);
        rain.set(date, (rain.get(date) ?? 0) + use.amount);
        coveredUntil = slot.at.getTime() + use.hours * 3_600_000;
      }

      // Every day MET gives (about 9–10); none is added.
      const dayList = [...byDay.entries()];
      const days: WeatherDay[] = dayList.map(([date, entries], dayIndex) => {
        const temperatures = entries.flatMap(({ slot }) => (slot.temperature === undefined ? [] : [slot.temperature]));
        const winds = entries.flatMap(({ slot }) => (slot.windSpeed === undefined ? [] : [slot.windSpeed]));
        // The daytime picture: the 12-hour period starting nearest to 06:00, else the 6-hour one nearest to noon.
        const nearest = (target: number, pick: (slot: Slot) => string | undefined) =>
          entries
            .filter(({ slot }) => pick(slot) !== undefined)
            .sort((a, b) => Math.abs(a.hour - target) - Math.abs(b.hour - target))[0];
        const daytime = nearest(6, (slot) => slot.hour12?.symbol) ?? nearest(12, (slot) => slot.hour6?.symbol);
        const symbol = daytime?.slot.hour12?.symbol ?? daytime?.slot.hour6?.symbol;
        const hours = entries.map(({ hour }) => hour);
        const condition: WeatherCondition | undefined = conditionFromMetSymbol(symbol);
        return {
          date,
          ...optional('min', temperatures.length === 0 ? undefined : round1(Math.min(...temperatures))),
          ...optional('max', temperatures.length === 0 ? undefined : round1(Math.max(...temperatures))),
          ...optional('precipitationSum', round1(rain.get(date))),
          ...optional('windSpeedMax', winds.length === 0 ? undefined : round1(Math.max(...winds))),
          ...optional('condition', condition),
          // Only the first day (data from now on) or the last (data ending early) can be partial; later days are
          // built from 6-hourly values, which is coarser but covers the whole day.
          ...((dayIndex === 0 && Math.min(...hours) > 1) || (dayIndex === dayList.length - 1 && Math.max(...hours) < 12) ? { partial: true } : {}),
        };
      });

      const meta = isRecord(properties.meta) ? properties.meta : {};
      const updated = typeof meta.updated_at === 'string' && !Number.isNaN(Date.parse(meta.updated_at)) ? new Date(meta.updated_at).toISOString() : undefined;
      const current = {
        ...optional('temperature', round1(first.temperature)),
        ...optional('condition', conditionFromMetSymbol(first.hour1?.symbol)),
        ...optional('windSpeed', round1(first.windSpeed)),
        ...optional('precipitation', round1(first.hour1?.precipitation)),
      };
      const lastModified = response.headers.get('last-modified') ?? undefined;
      return {
        kind: 'forecast',
        forecast: { provider: 'MET_NORWAY', ...optional('issuedAt', updated), ...(Object.keys(current).length > 0 ? { current } : {}), days },
        ...optional('expiresAt', expiresAt),
        ...optional('lastModified', lastModified),
      };
    },
  };
}
