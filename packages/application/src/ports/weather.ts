import type { Actor, OpenMeteoModelId, UserId, WeatherForecast, WeatherProviderId, WeatherSettings } from '@vergissmeinnicht/domain';

/** Why a weather request failed — stable codes, never a provider's own text (19.4). */
export type WeatherFailure = 'unavailable' | 'rate_limited' | 'bad_response' | 'not_covered' | 'not_allowed';

export class WeatherProviderError extends Error {
  readonly reason: WeatherFailure;
  constructor(reason: WeatherFailure) {
    super(`Weather provider: ${reason}`);
    this.name = 'WeatherProviderError';
    this.reason = reason;
  }
}

/** What a forecast is asked for. Coordinates are already rounded (2 decimals). */
export interface ForecastQuery {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number | null;
  readonly timeZone: string;
  /** Open-Meteo only. */
  readonly model?: OpenMeteoModelId;
  /** Provider cache validator from the previous answer (MET Norway `Last-Modified`). */
  readonly ifModifiedSince?: string;
}

export type ForecastAnswer =
  | { readonly kind: 'forecast'; readonly forecast: WeatherForecast; readonly expiresAt?: Date; readonly lastModified?: string }
  | { readonly kind: 'not_modified'; readonly expiresAt?: Date };

/** One allow-listed provider; the adapter owns its fixed endpoint, headers and parsing. */
export interface WeatherProviderAdapter {
  readonly id: WeatherProviderId;
  forecast(query: ForecastQuery): Promise<ForecastAnswer>;
}

/** Per Open-Meteo model at one place: covered at all, how many days, which values it has (W2). */
export interface ModelCoverage {
  readonly model: OpenMeteoModelId;
  readonly days: number;
  readonly hasCondition: boolean;
  readonly hasPrecipitationProbability: boolean;
}

export interface OpenMeteoModelsPort {
  coverage(query: Pick<ForecastQuery, 'latitude' | 'longitude' | 'elevation' | 'timeZone'>, models: readonly OpenMeteoModelId[]): Promise<ModelCoverage[]>;
}

export interface PlaceResult {
  readonly name: string;
  /** Region and country, for telling places with the same name apart. */
  readonly context: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number | null;
  readonly timeZone: string;
}

export interface GeocoderPort {
  search(text: string, language: string): Promise<PlaceResult[]>;
}

export interface WeatherSettingsRepository {
  find(userId: UserId): Promise<WeatherSettings | undefined>;
  save(userId: UserId, settings: WeatherSettings, at: Date): Promise<void>;
}

/** The server's weather settings (server admins only). */
export interface ServerWeatherSettings {
  /** Master switch (default on, T4/W1): off → no weather request of any kind. */
  readonly enabled: boolean;
  /** Providers that may be used on this server. */
  readonly allowed: readonly WeatherProviderId[];
  /** Optional contact email for MET Norway's User-Agent (W6). */
  readonly metContact: string | null;
}

export const DEFAULT_SERVER_WEATHER: ServerWeatherSettings = { enabled: true, allowed: ['OPEN_METEO', 'MET_NORWAY', 'OPENWEATHER', 'METEOMATICS'], metContact: null };

export interface ServerWeatherSettingsRepository {
  get(): Promise<ServerWeatherSettings>;
  /** Re-checks an ACTIVE server admin in the transaction and records WEATHER_SETTINGS_CHANGED; false = not allowed. */
  save(settings: ServerWeatherSettings, at: Date, actor: Extract<Actor, { kind: 'user' }>): Promise<boolean>;
}
