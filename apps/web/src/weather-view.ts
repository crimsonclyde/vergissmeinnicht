import { OPEN_METEO_MODELS, type WeatherCondition, type WeatherDay, type WeatherProviderId } from '@vergissmeinnicht/domain';
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

/** Whether a forecast fetched at `fetchedAt` may still be shown (with its time when stale). */
export const showable = (fetchedAt: string, now: Date = new Date()): boolean => now.getTime() - Date.parse(fetchedAt) <= WEATHER_SHOW_MAX_MS;
