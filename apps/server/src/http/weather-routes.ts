import { getMyWeather, getServerWeather, modelsFor, myForecast, saveMyWeather, saveServerWeather, searchPlaces, NoForecastError, type MyForecast } from '@vergissmeinnicht/application';
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

const forecastView = (result: MyForecast) => ({
  forecast: result.forecast,
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

  app.get('/', async (request) => getMyWeather(deps, { user: userOf(request) }));

  app.post('/', { bodyLimit: 4096 }, async (request) => {
    const body = parse(z.strictObject({ settings: z.unknown() }), request.body);
    return saveMyWeather(deps, { user: userOf(request), settings: body.settings });
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

  // No forecast is not an error for Today: it simply shows nothing; the Weather page shows the reason.
  app.get('/forecast', async (request) => {
    try {
      return forecastView(await myForecast(deps, { user: userOf(request) }));
    } catch (error) {
      if (error instanceof NoForecastError) return { forecast: null, reason: error.reason };
      throw error;
    }
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
