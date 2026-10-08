import type { Actor, CredentialProviderId, OpenMeteoModelId, UserId, WeatherCredential, WeatherForecast, WeatherProviderId, WeatherSettings } from '@vergissmeinnicht/domain';

/** Why a weather request failed — stable codes, never a provider's own text (19.4). */
export type WeatherFailure =
  | 'unavailable'
  | 'rate_limited'
  | 'bad_response'
  | 'not_covered'
  | 'not_allowed'
  // 19.4b: credential providers.
  | 'needs_credentials'
  | 'invalid_credentials'
  | 'quota_exhausted'
  | 'budget_reached'
  | 'needs_reentry';

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
  /** Credential providers only (19.4b): opened just for this request, never stored or logged by the adapter. */
  readonly credential?: WeatherCredential;
}

export type ForecastAnswer =
  | { readonly kind: 'forecast'; readonly forecast: WeatherForecast; readonly expiresAt?: Date; readonly lastModified?: string }
  | { readonly kind: 'not_modified'; readonly expiresAt?: Date };

/** One allow-listed provider; the adapter owns its fixed endpoint, headers and parsing. */
export interface WeatherProviderAdapter {
  readonly id: WeatherProviderId;
  /** Provider queries one forecast costs (counted against a credential's budget; default 1). */
  readonly queriesPerForecast?: number;
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

/** Whose credential: one set by a server admin for everyone, or a person's own (19.4b). */
export type CredentialScope = { readonly kind: 'SERVER' } | { readonly kind: 'USER'; readonly userId: UserId };

/** A stored credential as the server knows it — the secret only sealed. */
export interface StoredWeatherCredential {
  readonly id: string;
  readonly scope: CredentialScope;
  readonly provider: CredentialProviderId;
  readonly sealed: string;
  /** Server-wide only: people without their own credential may use it (W3). */
  readonly availableToUsers: boolean;
  readonly dailyBudget: number;
  /** Calls counted today (UTC day `usageDay`). */
  readonly usedToday: number;
  readonly usageDay: string | null;
  readonly lastTest: { readonly at: Date; readonly ok: boolean } | null;
  readonly updatedAt: Date;
}

export interface WeatherCredentialRepository {
  find(scope: CredentialScope, provider: CredentialProviderId): Promise<StoredWeatherCredential | undefined>;
  list(scope: CredentialScope): Promise<StoredWeatherCredential[]>;
  /**
   * Creates or replaces (new secret) a credential, or changes only its budget/availability (`sealed`
   * undefined). A SERVER credential needs an ACTIVE server admin, re-checked in the transaction; every
   * change records WEATHER_CREDENTIAL_CHANGED without the value. False = not allowed / nothing to change.
   */
  save(
    input: { readonly scope: CredentialScope; readonly provider: CredentialProviderId; readonly sealed?: string; readonly dailyBudget: number; readonly availableToUsers: boolean; readonly usedToday?: number; readonly at: Date },
    actor: Extract<Actor, { kind: 'user' }>,
  ): Promise<boolean>;
  remove(scope: CredentialScope, provider: CredentialProviderId, at: Date, actor: Extract<Actor, { kind: 'user' }>): Promise<boolean>;
  /** Counts `count` provider queries for today (UTC) if the budget allows all of them — atomically; false = budget reached. */
  consume(id: string, day: string, count: number): Promise<boolean>;
  recordTest(id: string, ok: boolean, at: Date): Promise<void>;
}

/** Seals and opens secrets with associated data (the existing secret box, DATA_ENCRYPTION_KEY). */
export interface WeatherSecrets {
  seal(plaintext: string, context: string): string;
  open(sealed: string, context: string): string | undefined;
}
