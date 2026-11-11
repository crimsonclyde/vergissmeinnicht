import { OPEN_METEO_MODELS, type WeatherCondition, type WeatherDay, type WeatherHistoryDay, type WeatherHour, type WeatherProviderId, type WeatherQuarter } from '@vergissmeinnicht/domain';
import type { UiIconName } from './ui-icons.tsx';

/** A forecast older than this is not shown at all, not even labelled (19.4). */
export const WEATHER_SHOW_MAX_MS = 6 * 60 * 60_000;

export const PROVIDER_NAMES: Record<WeatherProviderId, string> = { OPEN_METEO: 'Open-Meteo', MET_NORWAY: 'MET Norway', OPENWEATHER: 'OpenWeather', METEOMATICS: 'Meteomatics' };

/** Attribution the providers' licences ask for (CC BY 4.0 for Open-Meteo and MET Norway). */
export const ATTRIBUTION: Record<WeatherProviderId, { readonly text: string; readonly href: string }> = {
  OPEN_METEO: { text: 'Weather data by Open-Meteo.com (CC BY 4.0)', href: 'https://open-meteo.com/' },
  MET_NORWAY: { text: 'Weather data from MET Norway (CC BY 4.0)', href: 'https://api.met.no/' },
  OPENWEATHER: { text: 'Weather data by OpenWeather', href: 'https://openweathermap.org/' },
  METEOMATICS: { text: 'Weather data by Meteomatics', href: 'https://www.meteomatics.com/' },
};

const ICONS: Record<WeatherCondition, UiIconName> = {
  CLEAR: 'weatherClear',
  PARTLY_CLOUDY: 'weatherPartlyCloudy',
  CLOUDY: 'weatherCloudy',
  FOG: 'weatherFog',
  DRIZZLE: 'weatherDrizzle',
  RAIN: 'weatherRain',
  SHOWERS: 'weatherShowers',
  SLEET: 'weatherSleet',
  SNOW: 'weatherSnow',
  THUNDER: 'weatherThunder',
  UNKNOWN: 'weatherUnknown',
};

export const conditionIcon = (condition: WeatherCondition | undefined): UiIconName => ICONS[condition ?? 'UNKNOWN'];

/** "17°" — rounded; °F converted here only (the server always speaks °C). */
export function temperature(celsius: number | undefined, unit: 'C' | 'F'): string | null {
  if (celsius === undefined) return null;
  return `${Math.round(unit === 'F' ? celsius * 1.8 + 32 : celsius)}°`;
}

/** Rain as the provider gives it: a probability where there is one, else an amount — never invented. */
export function rainIndication(day: WeatherDay | undefined): { readonly kind: 'probability' | 'amount'; readonly value: number } | null {
  if (day?.precipitationProbabilityMax !== undefined) return { kind: 'probability', value: Math.round(day.precipitationProbabilityMax) };
  if (day?.precipitationSum !== undefined) return { kind: 'amount', value: day.precipitationSum };
  return null;
}

/** "Open-Meteo · ItaliaMeteo ARPAE ICON-2I" — who supplied the forecast (and with which model). */
export function sourceLabel(provider: WeatherProviderId, model: string | undefined): string {
  if (provider !== 'OPEN_METEO' || model === undefined || model === 'best_match') return PROVIDER_NAMES[provider];
  const label = OPEN_METEO_MODELS.find((each) => each.id === model)?.label.replace(/ \(.*\)$/, '') ?? model;
  return `${PROVIDER_NAMES[provider]} · ${label}`;
}

/** A calendar date `YYYY-MM-DD` moved by `days` (plain date arithmetic, independent of time zones). */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Weather page's history graph: 14 days ending at `today`, oldest first; a day without a stored sample has `range: null`. */
export function historyColumns(today: string, history: readonly WeatherHistoryDay[]): readonly { readonly date: string; readonly range: WeatherHistoryDay | null }[] {
  const byDate = new Map(history.map((each) => [each.date, each]));
  return Array.from({ length: HISTORY_COLUMNS }, (_, index) => {
    const date = shiftDate(today, index - (HISTORY_COLUMNS - 1));
    return { date, range: byDate.get(date) ?? null };
  });
}
const HISTORY_COLUMNS = 14;

/** Whether a forecast fetched at `fetchedAt` may still be shown (with its time when stale). */
export const showable = (fetchedAt: string, now: Date = new Date()): boolean => now.getTime() - Date.parse(fetchedAt) <= WEATHER_SHOW_MAX_MS;

/** The place's wall time now, `YYYY-MM-DDTHH:MM` — compared as text with the provider's local times. */
export function wallTimeAt(now: Date, timeZone: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return now.toISOString().slice(0, 16);
  }
}

/** Hours since midnight of a wall time `YYYY-MM-DDTHH:MM` (e.g. 7.5 for 07:30). */
export const hourOf = (time: string): number => Number(time.slice(11, 13)) + Number(time.slice(14, 16)) / 60;

export type MomentId = 'morning' | 'midday' | 'afternoon' | 'evening';
const MOMENTS: readonly { readonly id: MomentId; readonly hour: number }[] = [
  { id: 'morning', hour: 8 },
  { id: 'midday', hour: 12 },
  { id: 'afternoon', hour: 15 },
  { id: 'evening', hour: 19 },
];

/** Four moments of the day, each the forecast hour nearest to it (within 2 hours); a moment without one is left out. */
export function dayMoments(hours: readonly WeatherHour[]): readonly { readonly id: MomentId; readonly hour: WeatherHour }[] {
  return MOMENTS.flatMap(({ id, hour }) => {
    const nearest = hours
      .filter((each) => each.temperature !== undefined && Math.abs(hourOf(each.time) - hour) <= 2)
      .sort((a, b) => Math.abs(hourOf(a.time) - hour) - Math.abs(hourOf(b.time) - hour))[0];
    return nearest === undefined ? [] : [{ id, hour: nearest }];
  });
}

/** Precipitation below this (mm in 15 minutes) does not count as rain. */
const RAIN_QUARTER_MM = 0.1;

/**
 * Rain in the next hours from the 15-minute steps: `now` while the current step is wet, else the minutes until the
 * first wet step; `null` when it stays dry (or there are no steps). Steps that have passed are ignored.
 */
export function rainSoon(quarters: readonly WeatherQuarter[] | undefined, nowWall: string): { readonly kind: 'now' } | { readonly kind: 'in'; readonly minutes: number } | null {
  if (quarters === undefined) return null;
  const minutes = (time: string) => Date.parse(`${time}:00Z`) / 60_000;
  const now = minutes(nowWall);
  for (const quarter of quarters) {
    const start = minutes(quarter.time);
    if (start + 15 <= now) continue;
    if (quarter.precipitation < RAIN_QUARTER_MM) continue;
    if (start <= now) return { kind: 'now' };
    return { kind: 'in', minutes: Math.max(5, Math.round((start - now) / 5) * 5) };
  }
  return null;
}

export type UvLevel = 'low' | 'moderate' | 'high' | 'veryHigh' | 'extreme';
/** The WHO scale: 0–2 low, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme. */
export function uvLevel(index: number): UvLevel {
  const rounded = Math.round(index);
  return rounded <= 2 ? 'low' : rounded <= 5 ? 'moderate' : rounded <= 7 ? 'high' : rounded <= 10 ? 'veryHigh' : 'extreme';
}

/** First and last hour of the day with UV 3 or more (sun protection advised), or `null`. */
export function uvWindow(hours: readonly WeatherHour[]): { readonly from: string; readonly to: string } | null {
  const strong = hours.filter((hour) => hour.uvIndex !== undefined && Math.round(hour.uvIndex) >= 3);
  const first = strong[0];
  const last = strong.at(-1);
  if (first === undefined || last === undefined) return null;
  return { from: first.time, to: `${last.time.slice(0, 11)}${String(Math.min(23, Number(last.time.slice(11, 13)) + 1)).padStart(2, '0')}:00` };
}

/** Gusts are worth a tile only when they are strong (Beaufort 7, "near gale", from about 50 km/h). */
export const STRONG_GUSTS_KMH = 50;

/** A smooth SVG path through the points (Catmull-Rom as cubic Béziers); a single point is a dot-sized line. */
export function smoothPath(points: readonly { readonly x: number; readonly y: number }[]): string {
  const [first] = points;
  if (first === undefined) return '';
  if (points.length === 1) return `M${first.x} ${first.y}h0.01`;
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))] as { x: number; y: number };
  let path = `M${first.x} ${first.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C${round(c1.x)} ${round(c1.y)},${round(c2.x)} ${round(c2.y)},${round(p2.x)} ${round(p2.y)}`;
  }
  return path;
}
const round = (value: number) => Math.round(value * 10) / 10;

/** Runs of consecutive days that have a reading, for the history line (a gap breaks the line). */
export function historyRuns<T extends { readonly range: unknown }>(columns: readonly T[]): readonly (readonly { readonly index: number; readonly column: T }[])[] {
  const runs: { index: number; column: T }[][] = [];
  let current: { index: number; column: T }[] = [];
  columns.forEach((column, index) => {
    if (column.range === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else current.push({ index, column });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}
