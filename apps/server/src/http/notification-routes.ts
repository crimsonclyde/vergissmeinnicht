import {
  cancelTelegramPairing,
  configureTelegram,
  confirmTelegramPairing,
  disconnectTelegram,
  getNotificationProviders,
  getNotificationSettings,
  setEmailReminders,
  startTelegramPairing,
  testNotificationProvider,
  updateNotificationSettings,
  type NotificationSettingsView,
} from '@vergissmeinnicht/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const settingsBody = z
  .strictObject({ reminderTime: z.string().max(5).optional(), emailReminders: z.boolean().optional(), telegramReminders: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0);
const emailBody = z.strictObject({ enabled: z.boolean() });
// The token is only ever accepted in a JSON body (never in a URL) and never sent back.
const telegramBody = z.strictObject({ enabled: z.boolean(), botToken: z.string().max(128).nullable().optional() });
const testBody = z.strictObject({ provider: z.enum(['EMAIL', 'TELEGRAM']) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function userOf(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal.user;
}

/** Per account (after `requireUser`), persisted: pairing links, provider changes and test messages. */
const limited = (name: string, max: number) => ({
  rateLimit: {
    persist: name,
    max,
    timeWindow: 15 * 60_000,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => `${name}:${request.principal?.user.id ?? request.ip}`,
  },
});

const settingsView = (settings: NotificationSettingsView) => ({
  ...settings,
  telegram: {
    ...settings.telegram,
    connected: settings.telegram.connected === null ? null : { label: settings.telegram.connected.label, connectedAt: settings.telegram.connected.connectedAt.toISOString() },
    pairing: settings.telegram.pairing === null ? null : { expiresAt: settings.telegram.pairing.expiresAt.toISOString(), claimedBy: settings.telegram.pairing.claimedBy },
  },
});

/** Account → Notifications (13.8): the signed-in person's own channels. No provider secrets here. */
export async function accountNotificationRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.notifications;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => ({ settings: settingsView(await getNotificationSettings(deps, { user: userOf(request) })) }));

  app.post('/', { bodyLimit: 1024 }, async (request) => {
    const changes = parse(settingsBody, request.body);
    return { settings: settingsView(await updateNotificationSettings(deps, { user: userOf(request), changes })) };
  });

  // The pairing link is shown once; only its hash is stored.
  app.post('/telegram/pair', { config: limited('telegram-pairing', 10) }, async (request) => {
    const { url, expiresAt } = await startTelegramPairing(deps, { user: userOf(request) });
    return { url, expiresAt: expiresAt.toISOString() };
  });

  app.post('/telegram/confirm', { config: limited('telegram-pairing', 10) }, async (request) => ({
    settings: settingsView(await confirmTelegramPairing(deps, { user: userOf(request) })),
  }));

  app.post('/telegram/cancel', async (request) => ({ settings: settingsView(await cancelTelegramPairing(deps, { user: userOf(request) })) }));

  app.post('/telegram/disconnect', async (request) => ({ settings: settingsView(await disconnectTelegram(deps, { user: userOf(request) })) }));
}

/** Admin → Notification providers (13.7, 13.10): server admins only (checked in the use-cases). */
export async function adminNotificationRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.notifications;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => ({ providers: await getNotificationProviders(deps, { actor: userOf(request) }) }));

  app.post('/email', { bodyLimit: 1024, config: limited('notification-provider', 20) }, async (request) => {
    const { enabled } = parse(emailBody, request.body);
    return { providers: await setEmailReminders(deps, { actor: userOf(request), enabled }) };
  });

  app.post('/telegram', { bodyLimit: 1024, config: limited('notification-provider', 20) }, async (request) => {
    const body = parse(telegramBody, request.body);
    return { providers: await configureTelegram(deps, { actor: userOf(request), enabled: body.enabled, botToken: body.botToken }) };
  });

  app.post('/test', { bodyLimit: 1024, config: limited('notification-test', 5) }, async (request) => {
    const { provider } = parse(testBody, request.body);
    return { result: await testNotificationProvider(deps, { actor: userOf(request), provider }) };
  });
}
