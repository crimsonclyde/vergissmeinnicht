import { WeatherProviderError, type GeocoderPort, type ModelCoverage, type OpenMeteoModelsPort, type PlaceResult, type WeatherProviderAdapter } from '@vergissmeinnicht/application';
import { BIDI_CONTROLS, INVISIBLE_OR_INVALID_CHARS, conditionFromWmo, roundCoordinate, type OpenMeteoModelId, type WeatherDay } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';

/** The only hosts this adapter talks to (19.4; verified 2026-10-08). */
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'weather_code', 'wind_speed_10m_max'] as const;
const CURRENT = ['temperature_2m', 'weather_code', 'wind_speed_10m', 'precipitation'] as const;
export const FORECAST_DAYS = 3;
const COVERAGE_DAYS = 16;
const PLACES = 8;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      url.searchParams.set('wind_speed_unit', 'kmh');
      url.searchParams.set('models', query.model ?? 'best_match');
      const { body } = await getJson(doFetch, url, {});
      if (!isRecord(body) || !isRecord(body.daily)) throw new WeatherProviderError('bad_response');
      const daily = body.daily;
      const dates = array(daily.time);
      const days: WeatherDay[] = [];
      dates.slice(0, FORECAST_DAYS).forEach((date, index) => {
        if (typeof date !== 'string' || !DATE.test(date)) return;
        const at = (name: (typeof DAILY)[number]) => finite(array(daily[name])[index]);
        const day: WeatherDay = {
          date,
          ...optional('min', round1(at('temperature_2m_min'))),
          ...optional('max', round1(at('temperature_2m_max'))),
          ...optional('precipitationSum', round1(at('precipitation_sum'))),
          ...optional('precipitationProbabilityMax', at('precipitation_probability_max')),
          ...optional('windSpeedMax', round1(at('wind_speed_10m_max'))),
          ...optional('condition', conditionFromWmo(at('weather_code'))),
        };
        // A day with no value at all is outside what this model forecasts: leave it out.
        if (Object.keys(day).length > 1) days.push(day);
      });
      // Nothing for today: the model does not cover this place (W2).
      if (days.length === 0) throw new WeatherProviderError('not_covered');
      const current = isRecord(body.current) ? body.current : {};
      const now = {
        ...optional('temperature', round1(finite(current.temperature_2m))),
        ...optional('condition', conditionFromWmo(finite(current.weather_code))),
        ...optional('windSpeed', round1(finite(current.wind_speed_10m))),
        ...optional('precipitation', round1(finite(current.precipitation))),
      };
      return {
        kind: 'forecast',
        forecast: { provider: 'OPEN_METEO', model: query.model ?? 'best_match', ...(Object.keys(now).length > 0 ? { current: now } : {}), days },
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
