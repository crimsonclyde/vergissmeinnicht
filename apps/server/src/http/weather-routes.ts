import {
  compareForecasts,
  getMyWeather,
  getServerWeather,
  listServerCredentials,
  modelsFor,
  myForecast,
  removePersonalCredential,
  removeServerCredential,
  saveMyWeather,
  savePersonalCredential,
  saveServerCredential,
  saveServerWeather,
  searchPlaces,
  testPersonalCredential,
  testServerCredential,
  NoForecastError,
  type CompareResult,
  type CredentialStatus,
  type MyForecast,
  type MyWeather,
} from '@vergissmeinnicht/application';
import { WEATHER_PROVIDERS } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function userOf(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal.user;
}

/** Per account, persisted: outbound requests a person can cause on demand (search, model coverage). */
const perAccount = (name: string, max: number) => ({
  rateLimit: {
    persist: `weather-${name}`,
    max,
    timeWindow: 15 * 60_000,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => `weather-${name}:${request.principal?.user.id ?? request.ip}`,
  },
});

/** Status only — a credential's secret never leaves the server. */
const statusView = (status: CredentialStatus) => ({
  provider: status.provider,
  readable: status.readable,
  dailyBudget: status.dailyBudget,
  usedToday: status.usedToday,
  lastTest: status.lastTest === null ? null : { at: status.lastTest.at.toISOString(), ok: status.lastTest.ok },
  availableToUsers: status.availableToUsers,
  updatedAt: status.updatedAt.toISOString(),
});

const myWeatherView = (mine: MyWeather) => ({
  settings: mine.settings,
  providers: mine.providers,
  credentialProviders: mine.credentialProviders.map((entry) => ({ ...entry, personal: entry.personal === null ? null : statusView(entry.personal) })),
});

// The credential's shape is checked by the domain (provider-specific); here only size and structure.
const credentialBody = z.strictObject({ provider: z.string().max(32), credential: z.unknown().optional(), dailyBudget: z.number().int() });
const providerBody = z.strictObject({ provider: z.string().max(32) });

const compareView = (result: CompareResult) =>
  result.state === 'fresh' || result.state === 'cached' ? { ...result, fetchedAt: result.fetchedAt.toISOString() } : result;

const forecastView = (result: MyForecast) => ({
  forecast: result.forecast,
  horizon: result.horizon,
  location: { name: result.location.name, timeZone: result.location.timeZone },
  fetchedAt: result.fetchedAt.toISOString(),
  stale: result.stale,
  fellBackFrom: result.fellBackFrom,
  unit: result.unit,
  showTomorrow: result.showTomorrow,
});

/**
 * A person's own weather (19.4): settings, place search, Open-Meteo models for a place, and the forecast.
 * Only ever the signed-in person's data; while the server switch is off every route answers 404 `weather_off`.
 */
export async function accountWeatherRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.weather;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => myWeatherView(await getMyWeather(deps, { user: userOf(request) })));

  app.post('/', { bodyLimit: 4096 }, async (request) => {
    const body = parse(z.strictObject({ settings: z.unknown() }), request.body);
    return myWeatherView(await saveMyWeather(deps, { user: userOf(request), settings: body.settings }));
  });

  app.get('/places', { config: perAccount('search', 30) }, async (request) => {
    const query = parse(z.strictObject({ q: z.string().max(200), lang: z.string().max(8).default('en') }), request.query);
    return { places: await searchPlaces(deps, { user: userOf(request), text: query.q, language: query.lang }) };
  });

  // POST because it carries a place; it reads only (the same check as every request with a body applies).
  app.post('/models', { bodyLimit: 2048, config: perAccount('models', 30) }, async (request) => {
    const body = parse(z.strictObject({ location: z.unknown() }), request.body);
    return { models: await modelsFor(deps, { user: userOf(request), location: body.location }) };
  });

  // Compare forecasts (19.4c): only on the person's request, never polled; paid sources only with `fetchPaid`.
  app.post('/compare', { bodyLimit: 2048, config: perAccount('compare', 20) }, async (request) => {
    const body = parse(z.strictObject({ sources: z.array(z.unknown()).max(16), fetchPaid: z.boolean() }), request.body);
    try {
      const comparison = await compareForecasts(deps, { user: userOf(request), sources: body.sources, fetchPaid: body.fetchPaid });
      return { location: { name: comparison.location.name, timeZone: comparison.location.timeZone }, results: comparison.results.map(compareView) };
    } catch (error) {
      if (error instanceof NoForecastError) return { location: null, results: [], reason: error.reason };
      throw error;
    }
  });

  // No forecast is not an error for Today: it simply shows nothing; the Weather page shows the reason.
  // `days`: Today asks for 2; the Weather page for all the provider offers.
  app.get('/forecast', async (request) => {
    const query = parse(z.strictObject({ days: z.coerce.number().int().min(1).max(16).optional() }), request.query);
    try {
      return forecastView(await myForecast(deps, { user: userOf(request), ...(query.days === undefined ? {} : { days: query.days }) }));
    } catch (error) {
      if (error instanceof NoForecastError) return { forecast: null, reason: error.reason };
      throw error;
    }
  });
}

const credentialRateLimits = {
  change: perAccount('credential-change', 20),
  test: perAccount('credential-test', 5),
};

/** A person's own provider credentials (19.4b): never readable by anyone, only status comes back. */
export async function accountWeatherCredentialRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.weather;
  app.addHook('preHandler', requireUser(services));
  app.post('/', { bodyLimit: 2048, config: credentialRateLimits.change }, async (request) => {
    const body = parse(credentialBody, request.body);
    return { status: statusView(await savePersonalCredential(deps, { user: userOf(request), provider: body.provider, ...(body.credential === undefined ? {} : { credential: body.credential }), dailyBudget: body.dailyBudget })) };
  });
  app.post('/test', { bodyLimit: 256, config: credentialRateLimits.test }, async (request) => {
    const body = parse(providerBody, request.body);
    return { status: statusView(await testPersonalCredential(deps, { user: userOf(request), provider: body.provider })) };
  });
  app.post('/delete', { bodyLimit: 256, config: credentialRateLimits.change }, async (request, reply) => {
    const body = parse(providerBody, request.body);
    await removePersonalCredential(deps, { user: userOf(request), provider: body.provider });
    return reply.code(204).send();
  });
}

/** Server-wide provider credentials (server admins; authorization in the use-cases). */
export async function adminWeatherCredentialRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.weather;
  app.addHook('preHandler', requireUser(services));
  app.get('/', async (request) => ({ credentials: (await listServerCredentials(deps, { actor: userOf(request) })).map(statusView) }));
  app.post('/', { bodyLimit: 2048, config: credentialRateLimits.change }, async (request) => {
    const body = parse(credentialBody.extend({ availableToUsers: z.boolean() }), request.body);
    return {
      status: statusView(
        await saveServerCredential(deps, { actor: userOf(request), provider: body.provider, ...(body.credential === undefined ? {} : { credential: body.credential }), dailyBudget: body.dailyBudget, availableToUsers: body.availableToUsers }),
      ),
    };
  });
  app.post('/test', { bodyLimit: 256, config: credentialRateLimits.test }, async (request) => {
    const body = parse(providerBody, request.body);
    return { status: statusView(await testServerCredential(deps, { actor: userOf(request), provider: body.provider })) };
  });
  app.post('/delete', { bodyLimit: 256, config: credentialRateLimits.change }, async (request, reply) => {
    const body = parse(providerBody, request.body);
    await removeServerCredential(deps, { actor: userOf(request), provider: body.provider });
    return reply.code(204).send();
  });
}

const serverBody = z.strictObject({
  enabled: z.boolean(),
  allowed: z.array(z.enum(WEATHER_PROVIDERS)).max(WEATHER_PROVIDERS.length),
  metContact: z.string().max(254).nullable(),
});

/** The server's weather settings (server admins; authorization in the use-cases). */
export async function adminWeatherRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  app.get('/', async (request) => ({ settings: await getServerWeather(services.weather, { actor: userOf(request) }) }));
  app.post('/', { bodyLimit: 1024 }, async (request) => {
    const body = parse(serverBody, request.body);
    return { settings: await saveServerWeather(services.weather, { actor: userOf(request), settings: body }) };
  });
}
