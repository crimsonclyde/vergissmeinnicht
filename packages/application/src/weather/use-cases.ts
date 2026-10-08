import {
  DEFAULT_WEATHER_SETTINGS,
  DomainValidationError,
  KEYLESS_PROVIDERS,
  OPEN_METEO_MODELS,
  OPEN_METEO_MODEL_IDS,
  WEATHER_PROVIDERS,
  canAuthenticate,
  isActiveServerAdmin,
  parseWeatherLocation,
  parseWeatherSettings,
  type OpenMeteoModelId,
  type User,
  type WeatherForecast,
  type WeatherLocation,
  type WeatherProviderId,
  type WeatherSettings,
} from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import {
  WeatherProviderError,
  type ForecastQuery,
  type GeocoderPort,
  type ModelCoverage,
  type OpenMeteoModelsPort,
  type PlaceResult,
  type ServerWeatherSettings,
  type ServerWeatherSettingsRepository,
  type WeatherFailure,
  type WeatherProviderAdapter,
  type WeatherSettingsRepository,
} from '../ports/weather.ts';
import { userActor } from '../user-actor.ts';

/** Weather is switched off on this server (W1): every weather route answers like an unknown resource. */
export class WeatherOffError extends Error {
  constructor() {
    super('Weather is not available on this server');
    this.name = 'WeatherOffError';
  }
}

/** How long a forecast counts as fresh unless the provider says otherwise (MET: `Expires`). */
export const WEATHER_FRESH_MS = 30 * 60_000;
/** A forecast older than this is never shown, not even labelled as stale. */
export const WEATHER_STALE_MAX_MS = 6 * 60 * 60_000;
/** Which models cover a place changes rarely: asked again after a day. */
export const COVERAGE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;
export const PLACE_QUERY_MIN = 2;
export const PLACE_QUERY_MAX = 80;

interface CacheEntry {
  readonly forecast: WeatherForecast;
  readonly fetchedAt: Date;
  readonly freshUntil: Date;
  readonly lastModified?: string;
}

/**
 * The server's forecast cache (19.4): one entry per provider, model, rounded place, elevation and
 * credential scope; one request at a time per entry (concurrent viewers share it); bounded in size.
 * Results fetched without credentials (`scope: 'none'`) may be shared by everyone on this server.
 */
export function createWeatherService(deps: { readonly providers: readonly WeatherProviderAdapter[]; readonly models: OpenMeteoModelsPort; readonly geocoder: GeocoderPort; readonly clock: Clock }) {
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<CacheEntry>>();
  const coverage = new Map<string, { readonly at: Date; readonly models: ModelCoverage[] }>();
  const coverageInflight = new Map<string, Promise<ModelCoverage[]>>();

  const remember = <V>(map: Map<string, V>, key: string, value: V) => {
    map.delete(key);
    map.set(key, value);
    // Oldest first in insertion order: drop the least recently stored beyond the bound.
    while (map.size > CACHE_MAX_ENTRIES) map.delete(map.keys().next().value as string);
  };

  async function fetchFresh(adapter: WeatherProviderAdapter, key: string, query: ForecastQuery): Promise<CacheEntry> {
    const now = () => deps.clock.now();
    const previous = cache.get(key);
    const answer = await adapter.forecast(previous?.lastModified === undefined ? query : { ...query, ifModifiedSince: previous.lastModified });
    const fetchedAt = now();
    const freshUntil = answer.expiresAt ?? new Date(fetchedAt.getTime() + WEATHER_FRESH_MS);
    if (answer.kind === 'not_modified') {
      if (previous === undefined) throw new WeatherProviderError('bad_response');
      const entry = { ...previous, fetchedAt, freshUntil };
      remember(cache, key, entry);
      return entry;
    }
    const entry: CacheEntry = { forecast: answer.forecast, fetchedAt, freshUntil, ...(answer.lastModified === undefined ? {} : { lastModified: answer.lastModified }) };
    remember(cache, key, entry);
    return entry;
  }

  return {
    providerIds: deps.providers.map((adapter) => adapter.id),

    /** A forecast from one provider: fresh from the cache, else fetched (once for all waiting); a failure may fall back to a stale copy. */
    async forecast(provider: WeatherProviderId, query: ForecastQuery): Promise<{ readonly entry: CacheEntry; readonly stale: boolean }> {
      const adapter = deps.providers.find((each) => each.id === provider);
      if (adapter === undefined) throw new WeatherProviderError('not_allowed');
      const key = [provider, query.model ?? '-', query.latitude, query.longitude, query.elevation ?? '-', query.timeZone, 'none'].join('|');
      const cached = cache.get(key);
      if (cached !== undefined && cached.freshUntil.getTime() > deps.clock.now().getTime()) return { entry: cached, stale: false };
      let running = inflight.get(key);
      if (running === undefined) {
        running = fetchFresh(adapter, key, query).finally(() => inflight.delete(key));
        inflight.set(key, running);
      }
      try {
        return { entry: await running, stale: false };
      } catch (error) {
        if (cached !== undefined && deps.clock.now().getTime() - cached.fetchedAt.getTime() <= WEATHER_STALE_MAX_MS) return { entry: cached, stale: true };
        throw error;
      }
    },

    /** Which Open-Meteo models cover a place (W2), asked once per place and day. */
    async coverage(query: Pick<ForecastQuery, 'latitude' | 'longitude' | 'elevation' | 'timeZone'>): Promise<ModelCoverage[]> {
      const key = [query.latitude, query.longitude, query.elevation ?? '-', query.timeZone].join('|');
      const known = coverage.get(key);
      if (known !== undefined && deps.clock.now().getTime() - known.at.getTime() < COVERAGE_TTL_MS) return known.models;
      let running = coverageInflight.get(key);
      if (running === undefined) {
        running = deps.models
          .coverage(
            query,
            OPEN_METEO_MODEL_IDS.filter((id) => id !== 'best_match'),
          )
          .then((models) => {
            remember(coverage, key, { at: deps.clock.now(), models });
            return models;
          })
          .finally(() => coverageInflight.delete(key));
        coverageInflight.set(key, running);
      }
      return running;
    },

    search: (text: string, language: string) => deps.geocoder.search(text, language),
  };
}

export type WeatherService = ReturnType<typeof createWeatherService>;

export interface WeatherDeps {
  readonly weatherSettings: WeatherSettingsRepository;
  readonly serverWeather: ServerWeatherSettingsRepository;
  readonly weather: WeatherService;
  readonly clock: Clock;
}

async function enter(deps: WeatherDeps, user: User): Promise<ServerWeatherSettings> {
  if (!canAuthenticate(user)) throw new NotAuthorizedError();
  const server = await deps.serverWeather.get();
  if (!server.enabled) throw new WeatherOffError();
  return server;
}

/** Providers this server can use now: allowed by the admin and with an adapter (credential providers come with 19.4b). */
const usable = (deps: WeatherDeps, server: ServerWeatherSettings): WeatherProviderId[] => WEATHER_PROVIDERS.filter((id) => server.allowed.includes(id) && deps.weather.providerIds.includes(id));

export interface MyWeather {
  readonly settings: WeatherSettings;
  /** Providers the person can choose here. */
  readonly providers: readonly WeatherProviderId[];
}

/** The person's own weather settings (defaults when never saved) and what they can choose. */
export async function getMyWeather(deps: WeatherDeps, input: { readonly user: User }): Promise<MyWeather> {
  const server = await enter(deps, input.user);
  return { settings: (await deps.weatherSettings.find(input.user.id)) ?? DEFAULT_WEATHER_SETTINGS, providers: usable(deps, server) };
}

/** Saves the person's settings after strict validation; nothing is fetched here. */
export async function saveMyWeather(deps: WeatherDeps, input: { readonly user: User; readonly settings: unknown }): Promise<MyWeather> {
  const server = await enter(deps, input.user);
  const settings = parseWeatherSettings(input.settings);
  await deps.weatherSettings.save(input.user.id, settings, deps.clock.now());
  return { settings, providers: usable(deps, server) };
}

/** Place search (Open-Meteo geocoding) — only on an explicit action, only while Open-Meteo is allowed. */
export async function searchPlaces(deps: WeatherDeps, input: { readonly user: User; readonly text: string; readonly language: string }): Promise<PlaceResult[]> {
  const server = await enter(deps, input.user);
  if (!usable(deps, server).includes('OPEN_METEO')) throw new WeatherProviderError('not_allowed');
  const text = input.text.trim();
  if ([...text].length < PLACE_QUERY_MIN || [...text].length > PLACE_QUERY_MAX) throw new DomainValidationError('text', 'invalid_place_query', 'Search for 2 to 80 characters');
  return deps.weather.search(text, /^[a-z]{2}$/.test(input.language) ? input.language : 'en');
}

export interface ModelChoice {
  readonly id: OpenMeteoModelId;
  readonly label: string;
  /** Forecast days available at this place; `null` for Automatic. */
  readonly days: number | null;
  readonly hasCondition: boolean | null;
  readonly hasPrecipitationProbability: boolean | null;
}

/** Open-Meteo models for a location (the saved one, or one being chosen): Automatic plus those that cover it (W2). */
export async function modelsFor(deps: WeatherDeps, input: { readonly user: User; readonly location: unknown }): Promise<ModelChoice[]> {
  const server = await enter(deps, input.user);
  if (!usable(deps, server).includes('OPEN_METEO')) throw new WeatherProviderError('not_allowed');
  const location: WeatherLocation = parseWeatherLocation(input.location);
  const covered = await deps.weather.coverage(location);
  return OPEN_METEO_MODELS.flatMap((model): ModelChoice[] => {
    if (model.id === 'best_match') return [{ id: model.id, label: model.label, days: null, hasCondition: null, hasPrecipitationProbability: null }];
    const found = covered.find((each) => each.model === model.id);
    return found === undefined || found.days === 0 ? [] : [{ id: model.id, label: model.label, days: found.days, hasCondition: found.hasCondition, hasPrecipitationProbability: found.hasPrecipitationProbability }];
  });
}

export interface MyForecast {
  readonly forecast: WeatherForecast;
  readonly location: WeatherLocation;
  readonly fetchedAt: Date;
  /** Shown with its time: the provider failed and this copy is older than fresh (≤ 6 h). */
  readonly stale: boolean;
  /** Set when another provider than the chosen one answered (labelled, W4). */
  readonly fellBackFrom: WeatherProviderId | null;
  readonly unit: WeatherSettings['unit'];
  readonly showTomorrow: boolean;
}

/** Why no forecast could be shown — for the Weather page; Today simply shows nothing. */
export class NoForecastError extends Error {
  readonly reason: WeatherFailure | 'no_location';
  constructor(reason: WeatherFailure | 'no_location') {
    super(`No forecast: ${reason}`);
    this.name = 'NoForecastError';
    this.reason = reason;
  }
}

/**
 * The person's forecast: their provider (Automatic = Open-Meteo, then MET Norway — keyless only), their
 * model for Open-Meteo, labelled fallback when allowed (W4), a stale copy only with its time.
 */
export async function myForecast(deps: WeatherDeps, input: { readonly user: User }): Promise<MyForecast> {
  const server = await enter(deps, input.user);
  const settings = (await deps.weatherSettings.find(input.user.id)) ?? DEFAULT_WEATHER_SETTINGS;
  const location = settings.location;
  if (location === null) throw new NoForecastError('no_location');
  const available = usable(deps, server);
  const keyless = KEYLESS_PROVIDERS.filter((id) => available.includes(id));
  const order: WeatherProviderId[] =
    settings.provider === 'AUTO' ? keyless : [settings.provider, ...(settings.fallback ? keyless.filter((id) => id !== settings.provider) : [])];
  let failure: WeatherFailure = 'not_allowed';
  for (const provider of order) {
    if (!available.includes(provider)) continue;
    const query: ForecastQuery = {
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: location.elevation,
      timeZone: location.timeZone,
      ...(provider === 'OPEN_METEO' ? { model: settings.model } : {}),
    };
    try {
      const { entry, stale } = await deps.weather.forecast(provider, query);
      const chosen = settings.provider === 'AUTO' ? order[0] : settings.provider;
      return { forecast: entry.forecast, location, fetchedAt: entry.fetchedAt, stale, fellBackFrom: provider === chosen ? null : (chosen ?? null), unit: settings.unit, showTomorrow: settings.showTomorrow };
    } catch (error) {
      if (!(error instanceof WeatherProviderError)) throw error;
      // The first failure is the one that matters to the person (their chosen provider).
      if (failure === 'not_allowed') failure = error.reason;
    }
  }
  throw new NoForecastError(failure);
}

/** The server's weather settings, for server admins. */
export async function getServerWeather(deps: Pick<WeatherDeps, 'serverWeather'>, input: { readonly actor: User }): Promise<ServerWeatherSettings> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.serverWeather.get();
}

const EMAIL = /^[^\s@<>()"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** Server admins switch weather on/off, choose allowed providers and MET's contact (audited). */
export async function saveServerWeather(deps: Pick<WeatherDeps, 'serverWeather' | 'clock'>, input: { readonly actor: User; readonly settings: ServerWeatherSettings }): Promise<ServerWeatherSettings> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  const allowed = WEATHER_PROVIDERS.filter((id) => input.settings.allowed.includes(id));
  const contact = input.settings.metContact === null ? null : input.settings.metContact.trim();
  if (contact !== null && contact !== '' && !EMAIL.test(contact)) throw new DomainValidationError('metContact', 'invalid_email', 'Enter an email address');
  const settings: ServerWeatherSettings = { enabled: input.settings.enabled, allowed, metContact: contact === '' ? null : contact };
  if (!(await deps.serverWeather.save(settings, deps.clock.now(), userActor(input.actor)))) throw new NotAuthorizedError();
  return deps.serverWeather.get();
}
