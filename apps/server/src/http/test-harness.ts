// Test-only helper: a production-configured app on a fresh database, with captured email and
// signed-in demo users. Not imported by application code.
import { randomBytes } from 'node:crypto';
import { bootstrapServerAdmin, type EmailMessage } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';
import type { RunEventsOptions } from './run-events.ts';

export const ORIGIN = 'https://vmn.example.org';
export const PASSWORD = 'correct horse battery staple';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const INVITE_LINK = /\/invite\/([A-Za-z0-9_-]{43})/;

type App = Awaited<ReturnType<typeof buildApp>>;
export type InjectResponse = Awaited<ReturnType<App['inject']>>;

export async function startTestApp(options: { runEvents?: RunEventsOptions; trustedProxies?: readonly string[] } = {}) {
  const database = createTestDatabase();
  const outbox: EmailMessage[] = [];
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
  const app = await buildApp({
    trustedProxies: options.trustedProxies,
    services: (log) => {
      const built = createServices(config, database)(log);
      const email = { send: async (message: EmailMessage) => void outbox.push(message) };
      services = { ...built, invitations: { ...built.invitations, email }, runEvents: options.runEvents };
      return services;
    },
  });
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
    app,
    database,
    admin,
    post,
    get,
    invite,
    createWorkspace,
    addMember,
    async close() {
      await app.close();
      database.dispose();
    },
  };
}
