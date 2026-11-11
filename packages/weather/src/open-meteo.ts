import { WeatherProviderError, type GeocoderPort, type ModelCoverage, type OpenMeteoModelsPort, type PlaceResult, type WeatherProviderAdapter } from '@vergissmeinnicht/application';
import { BIDI_CONTROLS, INVISIBLE_OR_INVALID_CHARS, conditionFromWmo, roundCoordinate, type OpenMeteoModelId, type WeatherDay, type WeatherHour, type WeatherQuarter } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';

/** The only hosts this adapter talks to (19.4; verified 2026-10-08). */
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'weather_code', 'wind_speed_10m_max', 'uv_index_max', 'sunrise', 'sunset'] as const;
const CURRENT = ['temperature_2m', 'weather_code', 'wind_speed_10m', 'precipitation', 'apparent_temperature', 'wind_gusts_10m', 'uv_index'] as const;
const HOURLY = ['temperature_2m', 'weather_code', 'precipitation_probability', 'uv_index'] as const;
/** The next 3 hours in 15-minute steps: enough for "rain in 20 min". */
const QUARTERS = 12;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** Open-Meteo's longest horizon; a model with fewer days simply has no values for the rest (they are left out). */
export const FORECAST_DAYS = 16;
const COVERAGE_DAYS = 16;
const PLACES = 8;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A provider's local wall time `YYYY-MM-DDTHH:MM`, or nothing when it is not one. */
export const localTime = (value: unknown): string | undefined => (typeof value === 'string' && LOCAL_TIME.test(value) ? value : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEATHER_VALUES = ['min', 'max', 'precipitationSum', 'precipitationProbabilityMax', 'windSpeedMax', 'condition', 'uvIndexMax'] as const;

/**
 * Open-Meteo (19.4): forecasts with a chosen model, which models cover a place (W2), and place search.
 * Free for non-commercial use, no key; CC BY 4.0 (attribution shown with every forecast).
 */
export function createOpenMeteo(options: { readonly fetch?: Fetch } = {}): WeatherProviderAdapter & OpenMeteoModelsPort & GeocoderPort {
  const doFetch = options.fetch ?? fetch;

  const place = (url: URL, query: { latitude: number; longitude: number; elevation: number | null; timeZone: string }) => {
    url.searchParams.set('latitude', String(query.latitude));
    url.searchParams.set('longitude', String(query.longitude));
    url.searchParams.set('timezone', query.timeZone);
    if (query.elevation !== null) url.searchParams.set('elevation', String(query.elevation));
  };

  return {
    id: 'OPEN_METEO',

    async forecast(query) {
      const url = new URL(FORECAST_URL);
      place(url, query);
      url.searchParams.set('forecast_days', String(FORECAST_DAYS));
      url.searchParams.set('current', CURRENT.join(','));
      url.searchParams.set('daily', DAILY.join(','));
      // Same request: the hours of today and the next quarter hours (no extra call).
      url.searchParams.set('hourly', HOURLY.join(','));
      url.searchParams.set('minutely_15', 'precipitation');
      url.searchParams.set('forecast_minutely_15', String(QUARTERS));
      url.searchParams.set('wind_speed_unit', 'kmh');
      // A chosen model (often regional, 2–3 days) is asked together with the Automatic blend in the same
      // request; days past the model's own range are taken whole from the blend and marked `extended`.
      const chosen = query.model ?? 'best_match';
      const extend = chosen !== 'best_match';
      url.searchParams.set('models', extend ? `${chosen},best_match` : chosen);
      const { body } = await getJson(doFetch, url, {});
      if (!isRecord(body) || !isRecord(body.daily)) throw new WeatherProviderError('bad_response');
      // With several models every value carries the model's id as suffix; with one it has none.
      const values = (record: Record<string, unknown>, name: string, model: string = chosen): unknown[] => array(record[`${name}_${model}`] ?? record[name]);
      const daily = body.daily;
      const dates = array(daily.time);
      const days: WeatherDay[] = [];
      const dayFrom = (date: string, index: number, model: string): WeatherDay => {
        const at = (name: (typeof DAILY)[number]) => finite(values(daily, name, model)[index]);
        return {
          date,
          ...optional('min', round1(at('temperature_2m_min'))),
          ...optional('max', round1(at('temperature_2m_max'))),
          ...optional('precipitationSum', round1(at('precipitation_sum'))),
          ...optional('precipitationProbabilityMax', at('precipitation_probability_max')),
          ...optional('windSpeedMax', round1(at('wind_speed_10m_max'))),
          ...optional('condition', conditionFromWmo(at('weather_code'))),
          ...optional('uvIndexMax', round1(at('uv_index_max'))),
          ...optional('sunrise', localTime(values(daily, 'sunrise', model)[index])),
          ...optional('sunset', localTime(values(daily, 'sunset', model)[index])),
        };
      };
      // Sunrise and sunset are astronomy, not forecast: a day with only those is outside what the model covers.
      const hasWeather = (day: WeatherDay) => WEATHER_VALUES.some((key) => day[key] !== undefined);
      const own = dates.map((date, index) => (typeof date === 'string' && DATE.test(date) ? dayFrom(date, index, chosen) : null));
      // Only after the model's last own day: never a hole in the middle, and nothing if it covers no day.
      const lastOwn = own.findLastIndex((day) => day !== null && hasWeather(day));
      own.forEach((day, index) => {
        if (day === null) return;
        if (hasWeather(day)) { days.push(day); return; }
        if (!extend || lastOwn < 0 || index < lastOwn) return;
        const blend = dayFrom(day.date, index, 'best_match');
        if (hasWeather(blend)) days.push({ ...blend, extended: true });
      });
      // Nothing for today: the model does not cover this place (W2).
      if (days.length === 0) throw new WeatherProviderError('not_covered');
      const current = isRecord(body.current) ? body.current : {};
      const now1 = (name: (typeof CURRENT)[number]) => finite(current[`${name}_${chosen}`] ?? current[name]);
      const now = {
        ...optional('temperature', round1(now1('temperature_2m'))),
        ...optional('condition', conditionFromWmo(now1('weather_code'))),
        ...optional('windSpeed', round1(now1('wind_speed_10m'))),
        ...optional('precipitation', round1(now1('precipitation'))),
        ...optional('apparentTemperature', round1(now1('apparent_temperature'))),
        ...optional('windGusts', round1(now1('wind_gusts_10m'))),
        ...optional('uvIndex', round1(now1('uv_index'))),
      };
      const firstDay = days[0]?.date ?? '';
      const hourly = isRecord(body.hourly) ? body.hourly : {};
      const hours: WeatherHour[] = array(hourly.time).flatMap((time, index): WeatherHour[] => {
        const local = localTime(time);
        if (local === undefined || !local.startsWith(firstDay)) return [];
        const at = (name: (typeof HOURLY)[number]) => finite(values(hourly, name)[index]);
        const hour: WeatherHour = {
          time: local,
          ...optional('temperature', round1(at('temperature_2m'))),
          ...optional('condition', conditionFromWmo(at('weather_code'))),
          ...optional('precipitationProbability', at('precipitation_probability')),
          ...optional('uvIndex', round1(at('uv_index'))),
        };
        return Object.keys(hour).length > 1 ? [hour] : [];
      });
      const minutely = isRecord(body.minutely_15) ? body.minutely_15 : {};
      const quarters: WeatherQuarter[] = array(minutely.time).flatMap((time, index): WeatherQuarter[] => {
        const local = localTime(time);
        const precipitation = finite(values(minutely, 'precipitation')[index]);
        return local === undefined || precipitation === undefined ? [] : [{ time: local, precipitation: round1(precipitation) ?? 0 }];
      }).slice(0, QUARTERS);
      return {
        kind: 'forecast',
        forecast: {
          provider: 'OPEN_METEO',
          model: chosen,
          ...(Object.keys(now).length > 0 ? { current: now } : {}),
          days,
          ...(hours.length > 0 ? { hours } : {}),
          ...(quarters.length > 0 ? { quarters } : {}),
        },
      };
    },

    async coverage(query, models): Promise<ModelCoverage[]> {
      const url = new URL(FORECAST_URL);
      place(url, query);
      url.searchParams.set('forecast_days', String(COVERAGE_DAYS));
      url.searchParams.set('daily', 'temperature_2m_max,weather_code,precipitation_probability_max');
      url.searchParams.set('models', models.join(','));
      const { body } = await getJson(doFetch, url, {});
      if (!isRecord(body) || !isRecord(body.daily)) throw new WeatherProviderError('bad_response');
      const daily = body.daily;
      // With several models every value carries the model's id as suffix; a model whose area does not include the place is left out.
      return models.map((model: OpenMeteoModelId): ModelCoverage => {
        const values = (name: string) => array(daily[`${name}_${model}`]).map(finite);
        return {
          model,
          days: values('temperature_2m_max').filter((value) => value !== undefined).length,
          hasCondition: values('weather_code').some((value) => value !== undefined),
          hasPrecipitationProbability: values('precipitation_probability_max').some((value) => value !== undefined),
        };
      });
    },

    async search(text, language): Promise<PlaceResult[]> {
      const url = new URL(GEOCODING_URL);
      url.searchParams.set('name', text);
      url.searchParams.set('count', String(PLACES));
      url.searchParams.set('language', language);
      url.searchParams.set('format', 'json');
      const { body } = await getJson(doFetch, url, {});
      if (!isRecord(body)) throw new WeatherProviderError('bad_response');
      return array(body.results).flatMap((raw): PlaceResult[] => {
        if (!isRecord(raw)) return [];
        const latitude = finite(raw.latitude);
        const longitude = finite(raw.longitude);
        // Provider text is untrusted: no invisible, control or direction-changing characters.
        const clean = (value: unknown, max: number) => (typeof value === 'string' && !INVISIBLE_OR_INVALID_CHARS.test(value) && !BIDI_CONTROLS.test(value) ? value.trim().slice(0, max) : '');
        const name = clean(raw.name, 120);
        const timeZone = typeof raw.timezone === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(raw.timezone) ? raw.timezone : null;
        if (latitude === undefined || longitude === undefined || name === '' || timeZone === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
        const context = [clean(raw.admin1, 80), clean(raw.country, 80)].filter((part) => part !== '').join(', ');
        const elevation = finite(raw.elevation);
        return [{ name, context, latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude), elevation: elevation === undefined ? null : Math.round(elevation), timeZone }];
      });
    },
  };
}

/** `{ key: value }` only when the value exists — a missing value stays missing. */
export function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
