// Test-only helper: a production-configured app on a fresh database, with captured email and
// signed-in demo users. Not imported by application code.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { bootstrapServerAdmin, type EmailMessage, type TelegramBotApi } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';
import { loggerOptions } from '../logging.ts';
import type { RunEventsOptions } from './run-events.ts';

export const ORIGIN = 'https://vmn.example.org';
export const PASSWORD = 'violet anchor lantern marmalade';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const INVITE_LINK = /\/invite\/([A-Za-z0-9_-]{43})/;

type App = Awaited<ReturnType<typeof buildApp>>;
export type InjectResponse = Awaited<ReturnType<App['inject']>>;

export async function startTestApp(
  options: {
    runEvents?: RunEventsOptions;
    trustedProxies?: readonly string[];
    /** Replaces the real Telegram client (tests never reach api.telegram.org). */
    telegramApi?: TelegramBotApi;
    /** Capture the server log (info level, production serializers) into `logs`. */
    captureLogs?: boolean;
  } = {},
) {
  const database = createTestDatabase();
  const outbox: EmailMessage[] = [];
  let logs = '';
  const logStream = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  let services: AppServices | undefined;
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: ORIGIN,
    DATABASE_PATH: '/unused/by/tests.sqlite',
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    SMTP_HOST: '127.0.0.1',
    MAIL_FROM_ADDRESS: 'noreply@example.org',
    LOG_LEVEL: 'info',
  });
  const mediaDir = mkdtempSync(join(tmpdir(), 'vmn-test-media-'));
  const testConfig = { ...config, mediaPath: mediaDir, documentsPath: join(mediaDir, 'documents') };
  const build = () =>
    buildApp({
      trustedProxies: options.trustedProxies,
      ...(options.captureLogs === true ? { logger: { ...loggerOptions('info'), stream: logStream } } : {}),
      services: (log) => {
        const built = createServices(testConfig, database)(log);
        const email = { send: async (message: EmailMessage) => void outbox.push(message) };
        const notifications = { ...built.notifications, email, ...(options.telegramApi === undefined ? {} : { telegramApi: options.telegramApi }) };
        services = { ...built, invitations: { ...built.invitations, email }, notifications, runEvents: options.runEvents };
        return services;
      },
    });
  let app = await build();
  if (services === undefined) throw new Error('services were not built');
  const ready = services;

  /** `origin: null` omits the header. */
  const post = (url: string, payload?: object, cookie?: string, origin: string | null = ORIGIN) =>
    app.inject({
      method: 'POST',
      url,
      headers: { ...(origin === null ? {} : { origin }), ...(cookie === undefined ? {} : { cookie }) },
      ...(payload === undefined ? {} : { payload }),
    });
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });

  async function signIn(email: string): Promise<string> {
    const response = await post('/api/auth/sign-in', { email, password: PASSWORD });
    const session = [response.headers['set-cookie'] ?? []]
      .flat()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.split(';')[0];
    if (session === undefined) throw new Error(`sign-in as ${email} failed`);
    return session;
  }

  const { acceptUrl } = await bootstrapServerAdmin(ready.invitations, { email: normalizeEmail('admin@example.org') });
  await post('/api/invitations/accept', { token: INVITE_LINK.exec(acceptUrl)?.[1], displayName: 'Ada', password: PASSWORD });
  const admin = await signIn('admin@example.org');

  /** Invites and signs in a new user; returns their session cookie. */
  async function invite(email: string, displayName: string): Promise<string> {
    await post('/api/admin/invitations', { email }, admin);
    const token = INVITE_LINK.exec(outbox.at(-1)?.text ?? '')?.[1];
    await post('/api/invitations/accept', { token, displayName, password: PASSWORD });
    return signIn(email);
  }

  async function createWorkspace(name: string): Promise<string> {
    const response = await post('/api/workspaces', { name }, admin);
    if (response.statusCode !== 201) throw new Error(`workspace creation failed: ${response.statusCode}`);
    return (response.json() as { workspace: { id: string } }).workspace.id;
  }

  const addMember = (workspaceId: string, email: string, role: string) =>
    post(`/api/workspaces/${workspaceId}/members`, { email, role }, admin);

  return {
    get app() {
      return app;
    },
    /** A new process on the same database: in-memory state (e.g. ordinary rate limits) is gone. */
    async restart() {
      await app.close();
      app = await build();
    },
    database,
    /** The services of the running app (e.g. to run a scheduler task directly). */
    get services(): AppServices {
      if (services === undefined) throw new Error('services were not built');
      return services;
    },
    admin,
    outbox,
    /** Everything logged so far (with `captureLogs`). */
    get logs() {
      return logs;
    },
    post,
    get,
    invite,
    createWorkspace,
    addMember,
    async close() {
      await app.close();
      database.dispose();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}
