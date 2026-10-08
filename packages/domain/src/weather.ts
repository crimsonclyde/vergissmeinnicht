import { DomainValidationError } from './errors.ts';
import { parseTimeZone } from './schedule.ts';
import { normalizeSingleLineName } from './text.ts';

/**
 * Weather (19.4): a personal, optional forecast on Today. Providers are allow-listed and their endpoints
 * fixed in code; each person chooses a location (any place, never the device's position), a provider and,
 * for Open-Meteo, a model. Every forecast value is optional: what a provider does not supply stays missing.
 */
export const WEATHER_PROVIDERS = ['OPEN_METEO', 'MET_NORWAY', 'OPENWEATHER', 'METEOMATICS'] as const;
export type WeatherProviderId = (typeof WEATHER_PROVIDERS)[number];

/** Providers that need no credentials (Automatic only ever uses these, in this order — W4). */
export const KEYLESS_PROVIDERS: readonly WeatherProviderId[] = ['OPEN_METEO', 'MET_NORWAY'];

export const WEATHER_PROVIDER_CHOICES = ['AUTO', ...WEATHER_PROVIDERS] as const;
export type WeatherProviderChoice = (typeof WEATHER_PROVIDER_CHOICES)[number];

/**
 * Open-Meteo models a person may choose (verified 2026-10-08). `best_match` is Automatic. Whether a model
 * covers a place, how many days it forecasts and which values it has is asked from Open-Meteo for the
 * saved location (W2) — this list only says which ids exist and how to name them.
 */
export const OPEN_METEO_MODELS = [
  { id: 'best_match', label: 'Automatic (best match)', scope: 'auto' },
  { id: 'italia_meteo_arpae_icon_2i', label: 'ItaliaMeteo ARPAE ICON-2I (Italy, 2 km)', scope: 'regional' },
  { id: 'icon_d2', label: 'DWD ICON-D2 (Central Europe, 2 km)', scope: 'regional' },
  { id: 'meteofrance_arome_france_hd', label: 'Météo-France AROME HD (France, 1.5 km)', scope: 'regional' },
  { id: 'meteofrance_arome_france', label: 'Météo-France AROME (France, 2.5 km)', scope: 'regional' },
  { id: 'knmi_harmonie_arome_europe', label: 'KNMI HARMONIE-AROME (Europe, 5.5 km)', scope: 'regional' },
  { id: 'dmi_harmonie_arome_europe', label: 'DMI HARMONIE-AROME (Europe, 2 km)', scope: 'regional' },
  { id: 'ukmo_uk_deterministic_2km', label: 'UK Met Office (UK, 2 km)', scope: 'regional' },
  { id: 'metno_nordic', label: 'MET Nordic (Scandinavia, 1 km)', scope: 'regional' },
  { id: 'gem_hrdps_continental', label: 'GEM HRDPS (Canada, 2.5 km)', scope: 'regional' },
  { id: 'ncep_hrrr_conus', label: 'NCEP HRRR (USA, 3 km)', scope: 'regional' },
  { id: 'icon_eu', label: 'DWD ICON-EU (Europe, 7 km)', scope: 'regional' },
  { id: 'icon_seamless', label: 'DWD ICON seamless', scope: 'global' },
  { id: 'meteofrance_seamless', label: 'Météo-France seamless', scope: 'global' },
  { id: 'metno_seamless', label: 'MET Norway seamless', scope: 'global' },
  { id: 'ukmo_seamless', label: 'UK Met Office seamless', scope: 'global' },
  { id: 'gem_seamless', label: 'GEM seamless (Canada)', scope: 'global' },
  { id: 'jma_seamless', label: 'JMA seamless (Japan)', scope: 'global' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS (global, 25 km)', scope: 'global' },
  { id: 'ecmwf_aifs025_single', label: 'ECMWF AIFS (global, AI, 25 km)', scope: 'global' },
  { id: 'gfs_seamless', label: 'NOAA GFS seamless (global)', scope: 'global' },
] as const;
export type OpenMeteoModelId = (typeof OPEN_METEO_MODELS)[number]['id'];
export const OPEN_METEO_MODEL_IDS: readonly OpenMeteoModelId[] = OPEN_METEO_MODELS.map((model) => model.id);

/** Provider-neutral conditions; anything a provider code does not clearly say is `UNKNOWN`, never guessed. */
export const WEATHER_CONDITIONS = ['CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'DRIZZLE', 'RAIN', 'SHOWERS', 'SLEET', 'SNOW', 'THUNDER', 'UNKNOWN'] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** One calendar day at the location. `partial`: the provider's data covers only part of it (e.g. the rest of today). */
export interface WeatherDay {
  readonly date: string;
  readonly min?: number;
  readonly max?: number;
  /** mm */
  readonly precipitationSum?: number;
  /** % */
  readonly precipitationProbabilityMax?: number;
  /** km/h */
  readonly windSpeedMax?: number;
  readonly condition?: WeatherCondition;
  readonly partial?: boolean;
}

export interface WeatherCurrent {
  /** °C */
  readonly temperature?: number;
  readonly condition?: WeatherCondition;
  /** km/h */
  readonly windSpeed?: number;
  /** mm in the current hour */
  readonly precipitation?: number;
}

/** The normalised forecast every provider adapter returns (°C, mm, km/h, %). */
export interface WeatherForecast {
  readonly provider: WeatherProviderId;
  /** Open-Meteo model id, when a model was chosen. */
  readonly model?: string;
  /** When the provider says the forecast was issued or updated. */
  readonly issuedAt?: string;
  readonly current?: WeatherCurrent;
  readonly days: readonly WeatherDay[];
}

export const WEATHER_UNITS = ['C', 'F'] as const;
export type WeatherUnit = (typeof WEATHER_UNITS)[number];

export interface WeatherLocation {
  readonly name: string;
  /** Rounded to 2 decimals (≈ 1 km) before storage: all a forecast needs. */
  readonly latitude: number;
  readonly longitude: number;
  /** IANA zone of the place: days are its calendar days. */
  readonly timeZone: string;
  /** Metres; `null` = the provider's terrain model decides. */
  readonly elevation: number | null;
}

export interface WeatherSettings {
  readonly location: WeatherLocation | null;
  readonly provider: WeatherProviderChoice;
  readonly model: OpenMeteoModelId;
  /** An explicitly chosen provider failing → show a keyless one instead, labelled (W4). */
  readonly fallback: boolean;
  readonly unit: WeatherUnit;
  readonly showTomorrow: boolean;
}

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = { location: null, provider: 'AUTO', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true };

export const ELEVATION_MIN = -500;
export const ELEVATION_MAX = 9000;
export const PLACE_NAME_MAX = 120;

/** Two decimals: about 1 km — enough for a forecast, no more precise than needed. */
export const roundCoordinate = (value: number): number => Math.round(value * 100) / 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function refuse(field: string, code = 'invalid_weather_settings'): never {
  throw new DomainValidationError(field, code, 'The weather settings are not valid');
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(field);
}

function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) refuse(field);
  return value as T;
}

function number(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) refuse(field);
  return value;
}

export function parseWeatherLocation(input: unknown): WeatherLocation {
  if (!isRecord(input)) refuse('location');
  onlyKeys(input, ['name', 'latitude', 'longitude', 'timeZone', 'elevation'], 'location');
  if (typeof input.name !== 'string') refuse('location.name');
  const name = normalizeSingleLineName(input.name, { field: 'location.name', codePrefix: 'place_name', label: 'Place name', maxLength: PLACE_NAME_MAX });
  const latitude = roundCoordinate(number(input.latitude, -90, 90, 'location.latitude'));
  const longitude = roundCoordinate(number(input.longitude, -180, 180, 'location.longitude'));
  if (typeof input.timeZone !== 'string') refuse('location.timeZone');
  const timeZone = parseTimeZone(input.timeZone);
  const elevation = input.elevation === null || input.elevation === undefined ? null : number(input.elevation, ELEVATION_MIN, ELEVATION_MAX, 'location.elevation');
  if (elevation !== null && !Number.isInteger(elevation)) refuse('location.elevation');
  return { name, latitude, longitude, timeZone, elevation };
}

/** Strict: unknown fields and values out of range are refused, never dropped. */
export function parseWeatherSettings(input: unknown): WeatherSettings {
  if (!isRecord(input)) refuse('settings');
  onlyKeys(input, ['location', 'provider', 'model', 'fallback', 'unit', 'showTomorrow'], 'settings');
  if (typeof input.fallback !== 'boolean') refuse('fallback');
  if (typeof input.showTomorrow !== 'boolean') refuse('showTomorrow');
  return {
    location: input.location === null ? null : parseWeatherLocation(input.location),
    provider: oneOf(WEATHER_PROVIDER_CHOICES, input.provider, 'provider'),
    model: oneOf(OPEN_METEO_MODEL_IDS, input.model, 'model'),
    fallback: input.fallback,
    unit: oneOf(WEATHER_UNITS, input.unit, 'unit'),
    showTomorrow: input.showTomorrow,
  };
}

/** WMO weather interpretation codes (Open-Meteo). */
export function conditionFromWmo(code: number | null | undefined): WeatherCondition | undefined {
  if (code === null || code === undefined || !Number.isInteger(code)) return undefined;
  if (code === 0) return 'CLEAR';
  if (code === 1 || code === 2) return 'PARTLY_CLOUDY';
  if (code === 3) return 'CLOUDY';
  if (code === 45 || code === 48) return 'FOG';
  if (code >= 51 && code <= 57) return 'DRIZZLE';
  if ((code >= 61 && code <= 65) || code === 66 || code === 67) return code >= 66 ? 'SLEET' : 'RAIN';
  if (code >= 71 && code <= 77) return 'SNOW';
  if (code >= 80 && code <= 82) return 'SHOWERS';
  if (code === 85 || code === 86) return 'SNOW';
  if (code >= 95 && code <= 99) return 'THUNDER';
  return 'UNKNOWN';
}

/** MET Norway symbol codes (`partlycloudy_day`, `lightrainshowers_night`, …). */
export function conditionFromMetSymbol(symbol: string | null | undefined): WeatherCondition | undefined {
  if (typeof symbol !== 'string' || symbol === '') return undefined;
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('thunder')) return 'THUNDER';
  if (base.includes('sleet')) return 'SLEET';
  if (base.includes('snow')) return 'SNOW';
  if (base.includes('showers')) return 'SHOWERS';
  if (base.includes('rain')) return 'RAIN';
  if (base === 'fog') return 'FOG';
  if (base === 'clearsky') return 'CLEAR';
  if (base === 'fair' || base === 'partlycloudy') return 'PARTLY_CLOUDY';
  if (base === 'cloudy') return 'CLOUDY';
  return 'UNKNOWN';
}
