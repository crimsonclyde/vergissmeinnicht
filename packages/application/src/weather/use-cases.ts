import {
  CREDENTIAL_PROVIDERS,
  DEFAULT_WEATHER_SETTINGS,
  DomainValidationError,
  KEYLESS_PROVIDERS,
  OPEN_METEO_MODELS,
  OPEN_METEO_MODEL_IDS,
  WEATHER_PROVIDERS,
  canAuthenticate,
  isActiveServerAdmin,
  isCredentialProvider,
  parseCredentialBudget,
  parseWeatherCredential,
  parseWeatherLocation,
  parseWeatherSettings,
  type CredentialProviderId,
  type OpenMeteoModelId,
  type User,
  type WeatherCredential,
  type WeatherForecast,
  type WeatherLocation,
  type WeatherProviderId,
  type WeatherSettings,
} from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import {
  WeatherProviderError,
  type CredentialScope,
  type ForecastQuery,
  type GeocoderPort,
  type ModelCoverage,
  type OpenMeteoModelsPort,
  type PlaceResult,
  type ServerWeatherSettings,
  type ServerWeatherSettingsRepository,
  type StoredWeatherCredential,
  type WeatherCredentialRepository,
  type WeatherFailure,
  type WeatherProviderAdapter,
  type WeatherSecrets,
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
    /**
     * `scope`: `none` (no credential — shared by everyone), `server`, or `user:<id>` — a result fetched
     * with a person's own credential is cached for that person only (19.4b). `beforeFetch` runs only when
     * a request really goes out (budget check); a cache hit costs nothing.
     */
    async forecast(provider: WeatherProviderId, query: ForecastQuery, scope = 'none', beforeFetch?: () => Promise<void>): Promise<{ readonly entry: CacheEntry; readonly stale: boolean }> {
      const adapter = deps.providers.find((each) => each.id === provider);
      if (adapter === undefined) throw new WeatherProviderError('not_allowed');
      const key = [provider, query.model ?? '-', query.latitude, query.longitude, query.elevation ?? '-', query.timeZone, scope].join('|');
      const cached = cache.get(key);
      if (cached !== undefined && cached.freshUntil.getTime() > deps.clock.now().getTime()) return { entry: cached, stale: false };
      let running = inflight.get(key);
      if (running === undefined) {
        running = (async () => {
          await beforeFetch?.();
          return fetchFresh(adapter, key, query);
        })().finally(() => inflight.delete(key));
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

    queriesPerForecast: (provider: WeatherProviderId) => deps.providers.find((each) => each.id === provider)?.queriesPerForecast ?? 1,

    /** One request without the cache (credential tests). */
    async direct(provider: WeatherProviderId, query: ForecastQuery) {
      const adapter = deps.providers.find((each) => each.id === provider);
      if (adapter === undefined) throw new WeatherProviderError('not_allowed');
      return adapter.forecast(query);
    },
  };
}

export type WeatherService = ReturnType<typeof createWeatherService>;

export interface WeatherDeps {
  readonly weatherSettings: WeatherSettingsRepository;
  readonly serverWeather: ServerWeatherSettingsRepository;
  readonly weather: WeatherService;
  /** 19.4b: sealed provider credentials and the secret box that opens them. */
  readonly credentials: WeatherCredentialRepository;
  readonly secrets: WeatherSecrets;
  readonly clock: Clock;
}

async function enter(deps: WeatherDeps, user: User): Promise<ServerWeatherSettings> {
  if (!canAuthenticate(user)) throw new NotAuthorizedError();
  const server = await deps.serverWeather.get();
  if (!server.enabled) throw new WeatherOffError();
  return server;
}

/** Associated data of a sealed credential: a value copied to another owner or provider does not open. */
const credentialContext = (scope: CredentialScope, provider: CredentialProviderId) =>
  scope.kind === 'SERVER' ? `weather-credential:server:${provider}` : `weather-credential:user:${scope.userId}:${provider}`;

const serialize = (credential: WeatherCredential) => JSON.stringify(credential);

function openCredential(deps: WeatherDeps, stored: StoredWeatherCredential): WeatherCredential | undefined {
  const plain = deps.secrets.open(stored.sealed, credentialContext(stored.scope, stored.provider));
  if (plain === undefined) return undefined;
  try {
    const credential = parseWeatherCredential(JSON.parse(plain));
    return credential.provider === stored.provider ? credential : undefined;
  } catch {
    return undefined;
  }
}

/** The credential a person's request uses (W3): their own first; else the server's, if the admin made it available. */
async function credentialFor(deps: WeatherDeps, user: User, provider: CredentialProviderId): Promise<StoredWeatherCredential | undefined> {
  const own = await deps.credentials.find({ kind: 'USER', userId: user.id }, provider);
  if (own !== undefined) return own;
  const server = await deps.credentials.find({ kind: 'SERVER' }, provider);
  return server?.availableToUsers === true ? server : undefined;
}

/** Providers this person can use now: allowed by the admin, with an adapter, and — for credential providers — a usable credential. */
async function usable(deps: WeatherDeps, server: ServerWeatherSettings, user: User): Promise<WeatherProviderId[]> {
  const result: WeatherProviderId[] = [];
  for (const id of WEATHER_PROVIDERS) {
    if (!server.allowed.includes(id) || !deps.weather.providerIds.includes(id)) continue;
    if (isCredentialProvider(id) && (await credentialFor(deps, user, id)) === undefined) continue;
    result.push(id);
  }
  return result;
}

const today = (deps: Pick<WeatherDeps, 'clock'>) => deps.clock.now().toISOString().slice(0, 10);

/** Status of a credential — never the secret. `readable: false` = it must be entered again (key changed, restored elsewhere). */
export interface CredentialStatus {
  readonly provider: CredentialProviderId;
  readonly readable: boolean;
  readonly dailyBudget: number;
  readonly usedToday: number;
  readonly lastTest: { readonly at: Date; readonly ok: boolean } | null;
  readonly availableToUsers: boolean;
  readonly updatedAt: Date;
}

/** Per credential provider, what this person sees: allowed here, their own credential, and whether the server offers one. */
export interface CredentialProviderStatus {
  readonly provider: CredentialProviderId;
  readonly allowed: boolean;
  readonly personal: CredentialStatus | null;
  readonly serverAvailable: boolean;
}

export interface MyWeather {
  readonly settings: WeatherSettings;
  /** Providers the person can choose here. */
  readonly providers: readonly WeatherProviderId[];
  /** Optional credential providers and how they could be used (19.4b). */
  readonly credentialProviders: readonly CredentialProviderStatus[];
}

const statusOf = (deps: WeatherDeps, stored: StoredWeatherCredential): CredentialStatus => ({
  provider: stored.provider,
  readable: openCredential(deps, stored) !== undefined,
  dailyBudget: stored.dailyBudget,
  usedToday: stored.usageDay === today(deps) ? stored.usedToday : 0,
  lastTest: stored.lastTest,
  availableToUsers: stored.availableToUsers,
  updatedAt: stored.updatedAt,
});

async function myWeatherOf(deps: WeatherDeps, server: ServerWeatherSettings, user: User, settings: WeatherSettings): Promise<MyWeather> {
  const credentialProviders: CredentialProviderStatus[] = [];
  for (const provider of CREDENTIAL_PROVIDERS) {
    const own = await deps.credentials.find({ kind: 'USER', userId: user.id }, provider);
    const shared = await deps.credentials.find({ kind: 'SERVER' }, provider);
    credentialProviders.push({ provider, allowed: server.allowed.includes(provider) && deps.weather.providerIds.includes(provider), personal: own === undefined ? null : statusOf(deps, own), serverAvailable: shared?.availableToUsers === true });
  }
  return { settings, providers: await usable(deps, server, user), credentialProviders };
}

/** The person's own weather settings (defaults when never saved) and what they can choose. */
export async function getMyWeather(deps: WeatherDeps, input: { readonly user: User }): Promise<MyWeather> {
  const server = await enter(deps, input.user);
  return myWeatherOf(deps, server, input.user, (await deps.weatherSettings.find(input.user.id)) ?? DEFAULT_WEATHER_SETTINGS);
}

/** Saves the person's settings after strict validation; nothing is fetched here. */
export async function saveMyWeather(deps: WeatherDeps, input: { readonly user: User; readonly settings: unknown }): Promise<MyWeather> {
  const server = await enter(deps, input.user);
  const settings = parseWeatherSettings(input.settings);
  await deps.weatherSettings.save(input.user.id, settings, deps.clock.now());
  return myWeatherOf(deps, server, input.user, settings);
}

/** Place search (Open-Meteo geocoding) — only on an explicit action, only while Open-Meteo is allowed. */
export async function searchPlaces(deps: WeatherDeps, input: { readonly user: User; readonly text: string; readonly language: string }): Promise<PlaceResult[]> {
  const server = await enter(deps, input.user);
  if (!(await usable(deps, server, input.user)).includes('OPEN_METEO')) throw new WeatherProviderError('not_allowed');
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
  if (!(await usable(deps, server, input.user)).includes('OPEN_METEO')) throw new WeatherProviderError('not_allowed');
  const location: WeatherLocation = parseWeatherLocation(input.location);
  const covered = await deps.weather.coverage(location);
  return OPEN_METEO_MODELS.flatMap((model): ModelChoice[] => {
    if (model.id === 'best_match') return [{ id: model.id, label: model.label, days: null, hasCondition: null, hasPrecipitationProbability: null }];
    const found = covered.find((each) => each.model === model.id);
    return found === undefined || found.days === 0 ? [] : [{ id: model.id, label: model.label, days: found.days, hasCondition: found.hasCondition, hasPrecipitationProbability: found.hasPrecipitationProbability }];
  });
}

export interface MyForecast {
  /** Days limited to what was asked for (Today asks for 2); `horizon` says how many the provider offers. */
  readonly forecast: WeatherForecast;
  readonly horizon: number;
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
 * The person's forecast: their provider (Automatic = Open-Meteo, then MET Norway — keyless only, so it
 * never spends anyone's quota), their model for Open-Meteo, labelled fallback when allowed (W4), a stale
 * copy only with its time. Credential providers use the person's own credential, else the server's when
 * available (W3), within the credential's daily budget (W5). `days`: how many days to return (all when omitted).
 */
export async function myForecast(deps: WeatherDeps, input: { readonly user: User; readonly days?: number }): Promise<MyForecast> {
  const server = await enter(deps, input.user);
  const settings = (await deps.weatherSettings.find(input.user.id)) ?? DEFAULT_WEATHER_SETTINGS;
  const location = settings.location;
  if (location === null) throw new NoForecastError('no_location');
  const allowed = WEATHER_PROVIDERS.filter((id) => server.allowed.includes(id) && deps.weather.providerIds.includes(id));
  const keyless = KEYLESS_PROVIDERS.filter((id) => allowed.includes(id));
  const order: WeatherProviderId[] =
    settings.provider === 'AUTO' ? keyless : [settings.provider, ...(settings.fallback ? keyless.filter((id) => id !== settings.provider) : [])];
  let failure: WeatherFailure | null = null;
  for (const provider of order) {
    try {
      if (!allowed.includes(provider)) throw new WeatherProviderError('not_allowed');
      let query: ForecastQuery = {
        latitude: location.latitude,
        longitude: location.longitude,
        elevation: location.elevation,
        timeZone: location.timeZone,
        ...(provider === 'OPEN_METEO' ? { model: settings.model } : {}),
      };
      let scope = 'none';
      let beforeFetch: (() => Promise<void>) | undefined;
      if (isCredentialProvider(provider)) {
        const stored = await credentialFor(deps, input.user, provider);
        if (stored === undefined) throw new WeatherProviderError('needs_credentials');
        const credential = openCredential(deps, stored);
        if (credential === undefined) throw new WeatherProviderError('needs_reentry');
        query = { ...query, credential };
        scope = stored.scope.kind === 'SERVER' ? 'server' : `user:${stored.scope.userId}`;
        const queries = deps.weather.queriesPerForecast(provider);
        beforeFetch = async () => {
          if (!(await deps.credentials.consume(stored.id, today(deps), queries))) throw new WeatherProviderError('budget_reached');
        };
      }
      const { entry, stale } = await deps.weather.forecast(provider, query, scope, beforeFetch);
      const chosen = settings.provider === 'AUTO' ? order[0] : settings.provider;
      const days = input.days === undefined ? entry.forecast.days : entry.forecast.days.slice(0, input.days);
      return {
        forecast: { ...entry.forecast, days },
        horizon: entry.forecast.days.length,
        location,
        fetchedAt: entry.fetchedAt,
        stale,
        fellBackFrom: provider === chosen ? null : (chosen ?? null),
        unit: settings.unit,
        showTomorrow: settings.showTomorrow,
      };
    } catch (error) {
      if (!(error instanceof WeatherProviderError)) throw error;
      // The first failure is the one that matters to the person (their chosen provider).
      failure ??= error.reason;
    }
  }
  throw new NoForecastError(failure ?? 'not_allowed');
}

/** Rejects a credential provider that is not allowed on this server (or has no adapter). */
function allowedCredentialProvider(deps: WeatherDeps, server: ServerWeatherSettings, provider: unknown): CredentialProviderId {
  if (typeof provider !== 'string' || !(CREDENTIAL_PROVIDERS as readonly string[]).includes(provider)) throw new DomainValidationError('provider', 'invalid_credential', 'Unknown provider');
  const id = provider as CredentialProviderId;
  if (!server.allowed.includes(id) || !deps.weather.providerIds.includes(id)) throw new WeatherProviderError('not_allowed');
  return id;
}

/** A credential is tested with one real request (a fixed place; nothing personal is sent). */
const TEST_PLACE: ForecastQuery = { latitude: 0, longitude: 0, elevation: null, timeZone: 'UTC' };

async function tryCredential(deps: WeatherDeps, credential: WeatherCredential): Promise<void> {
  // Straight to the adapter: never cached, never shared.
  await deps.weather.direct(credential.provider, { ...TEST_PLACE, credential });
}

async function saveCredential(
  deps: WeatherDeps,
  input: { readonly actor: User; readonly scope: CredentialScope; readonly provider: unknown; readonly credential?: unknown; readonly dailyBudget: unknown; readonly availableToUsers: boolean },
): Promise<CredentialStatus> {
  const server = await enter(deps, input.actor);
  const provider = allowedCredentialProvider(deps, server, input.provider);
  const dailyBudget = parseCredentialBudget(provider, input.dailyBudget);
  const at = deps.clock.now();
  let sealed: string | undefined;
  if (input.credential !== undefined) {
    const credential = parseWeatherCredential(input.credential);
    if (credential.provider !== provider) throw new DomainValidationError('provider', 'invalid_credential', 'The credential is for another provider');
    // Tested before anything is stored: a failing credential is never kept.
    await tryCredential(deps, credential);
    sealed = deps.secrets.seal(serialize(credential), credentialContext(input.scope, provider));
  } else if ((await deps.credentials.find(input.scope, provider)) === undefined) {
    throw new DomainValidationError('credential', 'invalid_credential', 'Enter the credential first');
  }
  const ok = await deps.credentials.save({ scope: input.scope, provider, ...(sealed === undefined ? {} : { sealed, usedToday: deps.weather.queriesPerForecast(provider) }), dailyBudget, availableToUsers: input.availableToUsers, at }, userActor(input.actor));
  if (!ok) throw new NotAuthorizedError();
  const stored = await deps.credentials.find(input.scope, provider);
  if (stored === undefined) throw new NotAuthorizedError();
  return statusOf(deps, stored);
}

async function testCredential(deps: WeatherDeps, input: { readonly actor: User; readonly scope: CredentialScope; readonly provider: unknown }): Promise<CredentialStatus> {
  const server = await enter(deps, input.actor);
  const provider = allowedCredentialProvider(deps, server, input.provider);
  const stored = await deps.credentials.find(input.scope, provider);
  if (stored === undefined) throw new WeatherProviderError('needs_credentials');
  const credential = openCredential(deps, stored);
  if (credential === undefined) throw new WeatherProviderError('needs_reentry');
  if (!(await deps.credentials.consume(stored.id, today(deps), deps.weather.queriesPerForecast(provider)))) throw new WeatherProviderError('budget_reached');
  try {
    await tryCredential(deps, credential);
    await deps.credentials.recordTest(stored.id, true, deps.clock.now());
  } catch (error) {
    await deps.credentials.recordTest(stored.id, false, deps.clock.now());
    throw error;
  }
  return statusOf(deps, (await deps.credentials.find(input.scope, provider)) ?? stored);
}

async function removeCredential(deps: WeatherDeps, input: { readonly actor: User; readonly scope: CredentialScope; readonly provider: unknown }): Promise<void> {
  if (!canAuthenticate(input.actor)) throw new NotAuthorizedError();
  // Removing works even while weather is off or the provider is no longer allowed: nobody is stuck with a secret.
  if (typeof input.provider !== 'string' || !(CREDENTIAL_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainValidationError('provider', 'invalid_credential', 'Unknown provider');
  if (!(await deps.credentials.remove(input.scope, input.provider as CredentialProviderId, deps.clock.now(), userActor(input.actor)))) throw new WeatherProviderError('needs_credentials');
}

const own = (user: User): CredentialScope => ({ kind: 'USER', userId: user.id });

/** A person's own credential (19.4b): only ever for the signed-in person; tested before it is stored. */
export const savePersonalCredential = (deps: WeatherDeps, input: { readonly user: User; readonly provider: unknown; readonly credential?: unknown; readonly dailyBudget: unknown }) =>
  saveCredential(deps, { actor: input.user, scope: own(input.user), provider: input.provider, ...(input.credential === undefined ? {} : { credential: input.credential }), dailyBudget: input.dailyBudget, availableToUsers: false });
export const testPersonalCredential = (deps: WeatherDeps, input: { readonly user: User; readonly provider: unknown }) => testCredential(deps, { actor: input.user, scope: own(input.user), provider: input.provider });
export const removePersonalCredential = (deps: WeatherDeps, input: { readonly user: User; readonly provider: unknown }) => removeCredential(deps, { actor: input.user, scope: own(input.user), provider: input.provider });

function requireServerAdmin(user: User): void {
  if (!isActiveServerAdmin(user)) throw new NotAuthorizedError();
}

/** Server-wide credentials (server admins only; re-checked in the transaction). */
export async function listServerCredentials(deps: WeatherDeps, input: { readonly actor: User }): Promise<CredentialStatus[]> {
  requireServerAdmin(input.actor);
  return (await deps.credentials.list({ kind: 'SERVER' })).map((stored) => statusOf(deps, stored));
}
export async function saveServerCredential(deps: WeatherDeps, input: { readonly actor: User; readonly provider: unknown; readonly credential?: unknown; readonly dailyBudget: unknown; readonly availableToUsers: boolean }) {
  requireServerAdmin(input.actor);
  return saveCredential(deps, { actor: input.actor, scope: { kind: 'SERVER' }, provider: input.provider, ...(input.credential === undefined ? {} : { credential: input.credential }), dailyBudget: input.dailyBudget, availableToUsers: input.availableToUsers });
}
export async function testServerCredential(deps: WeatherDeps, input: { readonly actor: User; readonly provider: unknown }) {
  requireServerAdmin(input.actor);
  return testCredential(deps, { actor: input.actor, scope: { kind: 'SERVER' }, provider: input.provider });
}
export async function removeServerCredential(deps: WeatherDeps, input: { readonly actor: User; readonly provider: unknown }) {
  requireServerAdmin(input.actor);
  return removeCredential(deps, { actor: input.actor, scope: { kind: 'SERVER' }, provider: input.provider });
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
