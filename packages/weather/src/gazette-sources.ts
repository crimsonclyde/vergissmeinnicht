import { WeatherProviderError, type GazetteObservedDay, type GazettePlaceQuery, type GazetteStation, type GazetteWeatherSourcesPort } from '@vergissmeinnicht/application';
import { conditionFromWmo, type GazetteSourceDay, type GazetteWarning, type LiguriaAlertZone, type WeatherCondition } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';

/**
 * The Daily Planet's extra weather sources (43.7). Every host is fixed here (security.md: outbound
 * connections); answers are bounded, parsed defensively and never filled in.
 *
 * - Open-Meteo (CC BY 4.0, no key): several models in one request, each model's own days.
 * - Bright Sky (https://brightsky.dev, no key): DWD open data — MOSMIX forecasts, official warnings and
 *   station observations — as JSON. DWD data: © Deutscher Wetterdienst, used under the GeoNutzV.
 * - Meteoalarm (EUMETNET; https://meteoalarm.org): the Italian Air Force's awareness levels per region.
 * - AllertaLiguria (Regione Liguria / ARPAL): the published alert level per zone, read from the public
 *   home page (no API is offered). Only the level and the message time are taken; the page is linked.
 */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const BRIGHT_SKY_WEATHER = 'https://api.brightsky.dev/weather';
const BRIGHT_SKY_ALERTS = 'https://api.brightsky.dev/alerts';
const METEOALARM_ITALY = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-italy';
const ALLERTA_LIGURIA = 'https://allertaliguria.regione.liguria.it/';
/** The Italian feed covers the whole country (≈1.3 MB). */
const METEOALARM_MAX_BYTES = 3 * 1024 * 1024;
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A station day needs most of its hours: a partial day would show a false high or low. */
export const MIN_HOURS_PER_DAY = 18;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\uFFFD]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const put = <K extends keyof GazetteSourceDay>(day: Record<string, unknown>, key: K, value: GazetteSourceDay[K] | undefined) => { if (value !== undefined) day[key] = value; };

function localDate(at: Date, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
}
const addDay = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Bright Sky icon/condition → VMN condition. */
const BRIGHT_SKY_CONDITIONS: Record<string, WeatherCondition> = {
  'clear-day': 'CLEAR', 'clear-night': 'CLEAR', 'partly-cloudy-day': 'PARTLY_CLOUDY', 'partly-cloudy-night': 'PARTLY_CLOUDY', cloudy: 'CLOUDY', fog: 'FOG', wind: 'CLOUDY',
  rain: 'RAIN', sleet: 'SLEET', snow: 'SNOW', hail: 'THUNDER', thunderstorm: 'THUNDER',
};
const SEVERITY: readonly WeatherCondition[] = ['CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'DRIZZLE', 'SHOWERS', 'RAIN', 'SLEET', 'SNOW', 'THUNDER'];

interface Hour { readonly at: Date; readonly temperature?: number; readonly precipitation?: number; readonly probability?: number; readonly wind?: number; readonly gust?: number; readonly condition?: WeatherCondition }

/** Hourly records → local days: highs/lows from the hours, rain summed, the day's condition from 07–19 h. */
function withoutHours(day: GazetteSourceDay & { readonly hours: number }): GazetteSourceDay {
  const copy: GazetteSourceDay & { hours?: number } = { ...day };
  delete copy.hours;
  return copy;
}

function daysFromHours(hours: readonly Hour[], timeZone: string): (GazetteSourceDay & { readonly hours: number })[] {
  const byDate = new Map<string, Hour[]>();
  for (const hour of hours) { const date = localDate(hour.at, timeZone); byDate.set(date, [...(byDate.get(date) ?? []), hour]); }
  return [...byDate].flatMap(([date, list]) => {
    if (list.length < MIN_HOURS_PER_DAY) return [];
    const values = (pick: (h: Hour) => number | undefined) => list.map(pick).filter((v): v is number => v !== undefined);
    const temps = values(h => h.temperature), rain = values(h => h.precipitation), prob = values(h => h.probability), wind = values(h => h.wind), gust = values(h => h.gust);
    const daytime = list.filter(h => { const hour = localHour(h.at, timeZone); return hour >= 7 && hour <= 19; }).map(h => h.condition).filter((c): c is WeatherCondition => c !== undefined);
    const counts = new Map<WeatherCondition, number>();
    for (const c of daytime) counts.set(c, (counts.get(c) ?? 0) + 1);
    // Thunder from one hour; anything else from at least two daytime hours, the most severe of those.
    const condition = counts.has('THUNDER') ? 'THUNDER' : [...counts].filter(([, n]) => n >= 2).sort((a, b) => SEVERITY.indexOf(b[0]) - SEVERITY.indexOf(a[0]))[0]?.[0];
    const day: Record<string, unknown> = { date, hours: list.length };
    if (temps.length >= MIN_HOURS_PER_DAY) { put(day, 'high', round1(Math.max(...temps))); put(day, 'low', round1(Math.min(...temps))); }
    if (rain.length >= MIN_HOURS_PER_DAY) put(day, 'precipitationMm', round1(rain.reduce((a, b) => a + b, 0)));
    if (prob.length > 0) put(day, 'precipitationProbability', Math.max(...prob));
    if (wind.length > 0) put(day, 'windKmh', round1(Math.max(...wind)));
    if (gust.length > 0) put(day, 'gustKmh', round1(Math.max(...gust)));
    if (condition !== undefined) put(day, 'condition', condition);
    return [day as unknown as GazetteSourceDay & { hours: number }];
  });
}

interface BrightSkySource { readonly id: number; readonly type: string; readonly station: GazetteStation }
function brightSkySources(body: Record<string, unknown>): BrightSkySource[] {
  return array(body.sources).flatMap((raw): BrightSkySource[] => {
    if (!isRecord(raw)) return [];
    const id = finite(raw.id), distance = finite(raw.distance);
    if (id === undefined || distance === undefined || typeof raw.observation_type !== 'string') return [];
    return [{ id, type: raw.observation_type, station: { name: clean(raw.station_name, 80) || 'DWD station', distanceM: Math.round(distance), elevationM: finite(raw.height) ?? null } }];
  });
}
function brightSkyHours(body: Record<string, unknown>, sourceIds: ReadonlySet<number>): Hour[] {
  return array(body.weather).flatMap((raw): Hour[] => {
    if (!isRecord(raw) || typeof raw.timestamp !== 'string') return [];
    const at = new Date(raw.timestamp);
    if (Number.isNaN(at.getTime()) || !sourceIds.has(finite(raw.source_id) ?? -1)) return [];
    const icon = typeof raw.icon === 'string' ? BRIGHT_SKY_CONDITIONS[raw.icon] : undefined;
    const condition = raw.condition === 'thunderstorm' || raw.condition === 'hail' ? 'THUNDER' : icon;
    const hour: Record<string, unknown> = { at };
    for (const [key, value] of [['temperature', finite(raw.temperature)], ['precipitation', finite(raw.precipitation)], ['probability', finite(raw.precipitation_probability)], ['wind', finite(raw.wind_speed)], ['gust', finite(raw.wind_gust_speed)]] as const) if (value !== undefined) hour[key] = value;
    if (condition !== undefined) hour.condition = condition;
    return [hour as unknown as Hour];
  });
}

const WARNING_KINDS: readonly [RegExp, string][] = [[/thunder|gewitter|temporal/i, 'thunderstorm'], [/rain|regen|pioggi|precip/i, 'rain'], [/snow|schnee|neve/i, 'snow'], [/frost|ice|glätte|glatteis|gelo/i, 'frost'], [/gust|wind|böen|sturm|orkan|vento/i, 'wind'], [/fog|nebel|nebbia/i, 'fog'], [/heat|hitze|calore|high-temp/i, 'heat'], [/flood|hochwasser|idro|hydro|landslide|frana/i, 'hydro']];
const kindOf = (text: string) => WARNING_KINDS.find(([pattern]) => pattern.test(text))?.[1];

export function createGazetteWeatherSources(options: { readonly fetch?: Fetch; readonly userAgent: () => Promise<string>; readonly now?: () => Date }): GazetteWeatherSourcesPort {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const headers = async () => ({ 'user-agent': await options.userAgent() });

  async function brightSky(query: GazettePlaceQuery, from: string, to: string): Promise<Record<string, unknown>> {
    const url = new URL(BRIGHT_SKY_WEATHER);
    url.searchParams.set('lat', query.latitude.toFixed(2));
    url.searchParams.set('lon', query.longitude.toFixed(2));
    url.searchParams.set('date', from);
    url.searchParams.set('last_date', to);
    url.searchParams.set('tz', query.timeZone);
    url.searchParams.set('max_dist', '30000');
    const { body } = await getJson(doFetch, url, await headers());
    if (!isRecord(body)) throw new WeatherProviderError('bad_response');
    return body;
  }

  return {
    async openMeteoModels(query, models, days) {
      const url = new URL(OPEN_METEO);
      url.searchParams.set('latitude', String(query.latitude));
      url.searchParams.set('longitude', String(query.longitude));
      url.searchParams.set('timezone', query.timeZone);
      if (query.elevation !== null) url.searchParams.set('elevation', String(query.elevation));
      url.searchParams.set('daily', DAILY.join(','));
      url.searchParams.set('models', models.join(','));
      url.searchParams.set('forecast_days', String(Math.min(Math.max(days, 1), 16)));
      url.searchParams.set('wind_speed_unit', 'kmh');
      const { body } = await getJson(doFetch, url, {});
      if (!isRecord(body) || !isRecord(body.daily)) throw new WeatherProviderError('bad_response');
      const daily = body.daily;
      const dates = array(daily.time);
      const result: Record<string, GazetteSourceDay[]> = {};
      for (const model of models) {
        const values = (name: string) => array(daily[`${name}_${model}`] ?? (models.length === 1 ? daily[name] : undefined));
        result[model] = dates.flatMap((date, i): GazetteSourceDay[] => {
          if (typeof date !== 'string' || !DATE.test(date)) return [];
          const at = (name: (typeof DAILY)[number]) => finite(values(name)[i]);
          const day: Record<string, unknown> = { date };
          put(day, 'high', round1(at('temperature_2m_max'))); put(day, 'low', round1(at('temperature_2m_min')));
          put(day, 'precipitationMm', round1(at('precipitation_sum'))); put(day, 'precipitationProbability', at('precipitation_probability_max'));
          put(day, 'windKmh', round1(at('wind_speed_10m_max'))); put(day, 'gustKmh', round1(at('wind_gusts_10m_max')));
          put(day, 'condition', conditionFromWmo(at('weather_code')));
          // A day with no forecast value is outside the model's range or area.
          return day.high === undefined && day.low === undefined && day.precipitationMm === undefined ? [] : [day as unknown as GazetteSourceDay];
        });
      }
      return result;
    },

    async mosmix(query, from, days) {
      const body = await brightSky(query, from, addDay(from, days));
      const sources = brightSkySources(body).filter(source => source.type === 'forecast');
      const station = sources[0]?.station;
      if (station === undefined) throw new WeatherProviderError('not_covered');
      const result = daysFromHours(brightSkyHours(body, new Set(sources.map(source => source.id))), query.timeZone).filter(day => day.date >= from).map(withoutHours);
      if (result.length === 0) throw new WeatherProviderError('not_covered');
      return { station, days: result };
    },

    async dwdObservations(query, date) {
      const body = await brightSky(query, date, addDay(date, 1));
      const sources = brightSkySources(body).filter(source => source.type === 'historical' || source.type === 'current' || source.type === 'synop');
      if (sources.length === 0) return null;
      const day = daysFromHours(brightSkyHours(body, new Set(sources.map(source => source.id))), query.timeZone).find(item => item.date === date);
      if (day === undefined) return null;
      return { date, high: day.high ?? null, low: day.low ?? null, precipitationMm: day.precipitationMm ?? null, station: (sources[0] as BrightSkySource).station, hours: day.hours } satisfies GazetteObservedDay;
    },

    async dwdWarnings(query) {
      const url = new URL(BRIGHT_SKY_ALERTS);
      url.searchParams.set('lat', query.latitude.toFixed(2));
      url.searchParams.set('lon', query.longitude.toFixed(2));
      url.searchParams.set('tz', query.timeZone);
      const { body } = await getJson(doFetch, url, await headers());
      if (!isRecord(body) || !Array.isArray(body.alerts)) throw new WeatherProviderError('bad_response');
      const levels: Record<string, GazetteWarning['level']> = { minor: 'yellow', moderate: 'orange', severe: 'red', extreme: 'red' };
      return body.alerts.flatMap((raw): GazetteWarning[] => {
        if (!isRecord(raw) || raw.status !== 'actual') return [];
        const level = typeof raw.severity === 'string' ? levels[raw.severity] : undefined;
        const text = clean(raw.headline_en, 300) || clean(raw.headline_de, 300);
        const onset = typeof raw.onset === 'string' && !Number.isNaN(Date.parse(raw.onset)) ? new Date(raw.onset).toISOString() : null;
        const expires = typeof raw.expires === 'string' && !Number.isNaN(Date.parse(raw.expires)) ? new Date(raw.expires).toISOString() : null;
        if (level === undefined || text === '' || (expires !== null && Date.parse(expires) < now().getTime())) return [];
        const kind = kindOf(`${clean(raw.event_en, 80)} ${text}`);
        return [{ level, text, source: 'DWD', url: 'https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html', date: onset === null ? null : localDate(new Date(onset), query.timeZone) as GazetteWarning['date'], onset, expires, ...(kind ? { kind } : {}) }];
      });
    },

    async meteoalarmItaly(region) {
      const { body } = await getJson(doFetch, new URL(METEOALARM_ITALY), await headers(), { maxBytes: METEOALARM_MAX_BYTES, timeoutMs: 15_000 });
      if (!isRecord(body) || !Array.isArray(body.warnings)) throw new WeatherProviderError('bad_response');
      const levels: Record<string, GazetteWarning['level']> = { '2': 'yellow', '3': 'orange', '4': 'red' };
      const seen = new Set<string>();
      return body.warnings.flatMap((raw): GazetteWarning[] => {
        const alert = isRecord(raw) && isRecord(raw.alert) ? raw.alert : null;
        if (alert === null || alert.status !== 'Actual' || alert.msgType === 'Cancel') return [];
        return array(alert.info).flatMap((info): GazetteWarning[] => {
          if (!isRecord(info) || info.language !== 'en-GB' || !array(info.area).some(area => isRecord(area) && area.areaDesc === region)) return [];
          const parameter = (name: string) => { const found = array(info.parameter).find(p => isRecord(p) && p.valueName === name); return isRecord(found) && typeof found.value === 'string' ? found.value : ''; };
          const level = levels[parameter('awareness_level').split(';')[0]?.trim() ?? ''];
          const onset = typeof info.onset === 'string' && !Number.isNaN(Date.parse(info.onset)) ? new Date(info.onset).toISOString() : null;
          const expires = typeof info.expires === 'string' && !Number.isNaN(Date.parse(info.expires)) ? new Date(info.expires).toISOString() : null;
          const text = clean(info.event, 120);
          if (level === undefined || text === '' || (expires !== null && Date.parse(expires) < now().getTime())) return [];
          const key = `${text}|${onset}|${expires}`;
          if (seen.has(key)) return [];
          seen.add(key);
          const kind = kindOf(`${parameter('awareness_type')} ${text}`);
          return [{ level, text: `${text} (${region})`, source: 'Meteoalarm / Aeronautica Militare', url: `https://meteoalarm.org/en/live/region/IT`, date: onset === null ? null : localDate(new Date(onset), 'Europe/Rome') as GazetteWarning['date'], onset, expires, ...(kind ? { kind } : {}) }];
        });
      });
    },

    async allertaLiguria(zone: LiguriaAlertZone) {
      const { body } = await getJson(doFetch, new URL(ALLERTA_LIGURIA), await headers(), { text: true, maxBytes: 1024 * 1024 });
      if (typeof body !== 'string') throw new WeatherProviderError('bad_response');
      return parseAllertaLiguria(body, zone);
    },
  };
}

const ALLERTA_LEVELS: Record<string, { readonly level: GazetteWarning['level']; readonly name: string }> = { V: { level: 'info', name: 'green' }, G: { level: 'yellow', name: 'yellow' }, A: { level: 'orange', name: 'orange' }, R: { level: 'red', name: 'red' } };

/**
 * AllertaLiguria's home page: the regional map image is named after the highest level per zone A–E
 * (`img/mappe/V_V_G_V_V.png`, V = green, G = yellow, A = orange, R = red) and a message bar names the
 * message time. Anything else on the page is not read. A page that does not match is refused, never guessed.
 */
export function parseAllertaLiguria(page: string, zone: LiguriaAlertZone): GazetteWarning[] {
  const map = /img\/mappe\/([VGAR])_([VGAR])_([VGAR])_([VGAR])_([VGAR])\.png/.exec(page);
  const message = /Messaggio del (\d{2})\/(\d{2})\/(\d{4}) ore (\d{2}):(\d{2})/.exec(page);
  if (map === null || message === null) throw new WeatherProviderError('bad_response');
  const letter = map['ABCDE'.indexOf(zone) + 1] as string;
  const level = ALLERTA_LEVELS[letter];
  if (level === undefined) throw new WeatherProviderError('bad_response');
  const [, dd, mm, yyyy, hh, min] = message;
  const issued = `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  const url = 'https://allertaliguria.regione.liguria.it/';
  const warnings: GazetteWarning[] = [{
    level: level.level, source: 'AllertaLiguria', url, date: null, kind: 'hydro',
    text: level.level === 'info' ? `No civil protection alert for zone ${zone} (message ${issued}).` : `Civil protection alert ${level.name} for zone ${zone} (message ${issued}); see AllertaLiguria for phenomena and times.`,
  }];
  // The bar's second line names a meteorological risk without an alert ("Rischio meteo per vento").
  // Linear: find the phrase first, then match a short slice (no backtracking over the whole page).
  const at = page.search(/Rischio meteo per /i);
  const risk = at < 0 ? undefined : /^(Rischio meteo per [a-zà-ù ,]{2,60}?)\s*<\/h2>/i.exec(page.slice(at, at + 120))?.[1];
  if (risk) warnings.push({ level: 'info', source: 'ARPAL', url: 'https://allertaliguria.regione.liguria.it/bollettino_vigilanza_arpal.php', date: null, text: `${risk.replace(/\s+/g, ' ').trim()} (ARPAL, message ${issued}).`, ...(kindOf(risk) ? { kind: kindOf(risk) as string } : {}) });
  return warnings;
}
