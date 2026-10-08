import { WeatherProviderError, type WeatherProviderAdapter } from '@vergissmeinnicht/application';
import { conditionFromOpenWeather, type WeatherDay } from '@vergissmeinnicht/domain';
import { finite, getJson, isRecord, round1, type Fetch } from './http.ts';
import { optional } from './open-meteo.ts';

/** The only URL this adapter talks to: One Call 3.0 (one billed call for current + 8 days; verified 2026-10-08). */
const ONE_CALL_URL = 'https://api.openweathermap.org/data/3.0/onecall';
const MS_TO_KMH = 3.6;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const firstWeatherId = (value: unknown) => finite(isRecord(array(value)[0]) ? (array(value)[0] as Record<string, unknown>).id : undefined);

/**
 * OpenWeather One Call 3.0 (19.4b) — optional, needs the person's or the server's API key. The key travels
 * as `appid` in the query string (OpenWeather's only way): the URL is therefore never logged or put into
 * an error (see `getJson`). One request = one billed call; 1 000/day are free, more are charged
 * automatically by OpenWeather, so VMN's daily budget never exceeds 1 000 (W5). No elevation parameter.
 */
export function createOpenWeather(options: { readonly fetch?: Fetch } = {}): WeatherProviderAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'OPENWEATHER',
    queriesPerForecast: 1,

    async forecast(query) {
      if (query.credential?.provider !== 'OPENWEATHER') throw new WeatherProviderError('needs_credentials');
      const url = new URL(ONE_CALL_URL);
      url.searchParams.set('lat', String(query.latitude));
      url.searchParams.set('lon', String(query.longitude));
      url.searchParams.set('units', 'metric');
      url.searchParams.set('exclude', 'minutely,hourly,alerts');
      url.searchParams.set('appid', query.credential.apiKey);
      const { body } = await getJson(doFetch, url, {}, { classify: (status) => (status === 401 || status === 403 ? 'invalid_credentials' : status === 429 ? 'quota_exhausted' : status === 404 ? 'not_covered' : undefined) });
      if (!isRecord(body)) throw new WeatherProviderError('bad_response');
      const offsetMs = (finite(body.timezone_offset) ?? 0) * 1000;
      const days: WeatherDay[] = array(body.daily).flatMap((raw): WeatherDay[] => {
        if (!isRecord(raw)) return [];
        const dt = finite(raw.dt);
        if (dt === undefined) return [];
        const temp = isRecord(raw.temp) ? raw.temp : {};
        const rain = finite(raw.rain);
        const snow = finite(raw.snow);
        const pop = finite(raw.pop);
        const wind = finite(raw.wind_speed);
        // `dt` is a moment within the local day: shifted by the place's offset it names that day.
        const date = new Date(dt * 1000 + offsetMs).toISOString().slice(0, 10);
        return [
          {
            date,
            ...optional('min', round1(finite(temp.min))),
            ...optional('max', round1(finite(temp.max))),
            // Rain and snow (water equivalent) are each given only where expected; neither = missing, not 0.
            ...optional('precipitationSum', rain === undefined && snow === undefined ? undefined : round1((rain ?? 0) + (snow ?? 0))),
            ...optional('precipitationProbabilityMax', pop === undefined ? undefined : Math.round(pop * 100)),
            ...optional('windSpeedMax', wind === undefined ? undefined : round1(wind * MS_TO_KMH)),
            ...optional('condition', conditionFromOpenWeather(firstWeatherId(raw.weather))),
          },
        ];
      });
      if (days.length === 0) throw new WeatherProviderError('bad_response');
      const current = isRecord(body.current) ? body.current : {};
      const wind = finite(current.wind_speed);
      const rain = isRecord(current.rain) ? finite(current.rain['1h']) : undefined;
      const now = {
        ...optional('temperature', round1(finite(current.temp))),
        ...optional('condition', conditionFromOpenWeather(firstWeatherId(current.weather))),
        ...optional('windSpeed', wind === undefined ? undefined : round1(wind * MS_TO_KMH)),
        ...optional('precipitation', round1(rain)),
      };
      const issued = finite(current.dt);
      return {
        kind: 'forecast',
        forecast: { provider: 'OPENWEATHER', ...optional('issuedAt', issued === undefined ? undefined : new Date(issued * 1000).toISOString()), ...(Object.keys(now).length > 0 ? { current: now } : {}), days },
        // OpenWeather updates every 10 minutes; VMN keeps its usual 30 minutes to save calls.
      };
    },
  };
}

