import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapServerAdmin, type EmailMessage } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';
import { loggerOptions } from '../logging.ts';

const ORIGIN = 'https://vmn.example.org';
const ADMIN_PASSWORD = 'admin passphrase for tests';
const BOB_PASSWORD = 'bob original passphrase';
const NEW_PASSWORD = 'bob brand new passphrase';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const RECOVER_LINK = /\/recover\/([A-Za-z0-9_-]{43})/;
const INVITE_LINK = /\/invite\/([A-Za-z0-9_-]{43})/;

type App = Awaited<ReturnType<typeof buildApp>>;
type Response = Awaited<ReturnType<App['inject']>>;

describe('account recovery HTTP API', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let app: App;
  let services: AppServices;
  let outbox: EmailMessage[];
  let logs: string;
  let now: Date;

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

  const cookie = (response: Response) =>
    [response.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
  const post = (url: string, payload?: object, cookieHeader?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin: ORIGIN, ...(cookieHeader === undefined ? {} : { cookie: cookieHeader }) },
      ...(payload === undefined ? {} : { payload }),
    });
  const get = (url: string, cookieHeader?: string) =>
    app.inject({ method: 'GET', url, headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } });
  async function signIn(email: string, password: string): Promise<string> {
    const session = cookie(await post('/api/auth/sign-in', { email, password }));
    if (session === undefined) throw new Error('sign-in failed');
    return session;
  }
  const lastLink = (pattern: RegExp) => pattern.exec(outbox.at(-1)?.text ?? '')?.[1] ?? '';
  const recover = (adminCookie: string, extra: object = {}) =>
    post(
      '/api/admin/recoveries',
      { email: 'bob@example.org', resetPassword: true, resetTotp: false, password: ADMIN_PASSWORD, ...extra },
      adminCookie,
    );

  let adminCookie: string;

  beforeEach(async () => {
    database = createTestDatabase();
    outbox = [];
    logs = '';
    now = new Date();
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += String(chunk);
        callback();
      },
    });
    app = await buildApp({
      logger: { ...loggerOptions('info'), stream },
      services: (log) => {
        const built = createServices(config, database)(log);
        const email = { send: async (message: EmailMessage) => void outbox.push(message) };
        const clock = { now: () => now };
        const mfa = { ...built.mfa, clock };
        services = {
          ...built,
          mfa,
          invitations: { ...built.invitations, email },
          recovery: { ...built.recovery, mfa, email, clock },
        };
        return services;
      },
    });
    const { acceptUrl } = await bootstrapServerAdmin(services.invitations, { email: normalizeEmail('admin@example.org') });
    await post('/api/invitations/accept', { token: INVITE_LINK.exec(acceptUrl)?.[1], displayName: 'Ada', password: ADMIN_PASSWORD });
    adminCookie = await signIn('admin@example.org', ADMIN_PASSWORD);
    await post('/api/admin/invitations', { email: 'bob@example.org' }, adminCookie);
    await post('/api/invitations/accept', { token: lastLink(INVITE_LINK), displayName: 'Bob', password: BOB_PASSWORD });
  });

  afterEach(async () => {
    await app.close();
    database.dispose();
  });

  it('lets an admin send a password reset link that ends all of the user’s sessions', async () => {
    const bobCookie = await signIn('bob@example.org', BOB_PASSWORD);
    const issued = await recover(adminCookie);
    expect(issued.statusCode).toBe(201);
    expect(issued.json()).toMatchObject({ delivery: 'sent', recovery: { resetPassword: true, resetTotp: false } });
    const token = lastLink(RECOVER_LINK);
    expect(outbox.at(-1)?.to).toBe('bob@example.org');
    expect(issued.body).not.toContain(token);

    const resolved = await post('/api/recoveries/resolve', { token });
    expect(resolved.json()).toMatchObject({ email: 'bob@example.org', requiresCurrentPassword: false });
    const completed = await post('/api/recoveries/complete', { token, newPassword: NEW_PASSWORD });
    expect(completed.statusCode).toBe(204);
    expect(cookie(completed)).toBeUndefined();

    expect((await get('/api/auth/session', bobCookie)).statusCode).toBe(401);
    expect((await get('/api/auth/session', adminCookie)).statusCode).toBe(200);
    expect((await post('/api/auth/sign-in', { email: 'bob@example.org', password: BOB_PASSWORD })).statusCode).toBe(401);
    await signIn('bob@example.org', NEW_PASSWORD);
    expect((await post('/api/recoveries/complete', { token, newPassword: 'another passphrase here' })).statusCode).toBe(404);

    expect(logs).not.toContain(token);
    expect(logs).not.toContain(NEW_PASSWORD);
  });

  it('is forbidden for non-admins and requires the admin password', async () => {
    const bobCookie = await signIn('bob@example.org', BOB_PASSWORD);
    const byBob = await post(
      '/api/admin/recoveries',
      { email: 'admin@example.org', resetPassword: true, resetTotp: false, password: BOB_PASSWORD },
      bobCookie,
    );
    expect(byBob.statusCode).toBe(403);
    expect((await recover(adminCookie, { password: 'not the admin password' })).statusCode).toBe(403);
    expect((await post('/api/admin/recoveries', { email: 'bob@example.org', resetPassword: true, resetTotp: false, password: ADMIN_PASSWORD })).statusCode).toBe(401);
    expect(outbox.filter((m) => m.subject.includes('recovery'))).toHaveLength(0);
  });

  it('rejects empty scopes, self-recovery and unknown accounts', async () => {
    expect((await recover(adminCookie, { resetPassword: false })).statusCode).toBe(400);
    expect((await recover(adminCookie, { email: 'admin@example.org' })).statusCode).toBe(403);
    expect((await recover(adminCookie, { email: 'nobody@example.org' })).statusCode).toBe(404);
  });

  it('requires the admin TOTP code when the admin has TOTP', async () => {
    const setup = await post('/api/account/mfa/totp/setup', { password: ADMIN_PASSWORD }, adminCookie);
    const { secret } = setup.json<{ secret: string }>();
    const code = () => TOTP.generate({ secret: new TOTP({ secret }).secret, timestamp: now.getTime() });
    const confirmed = await post('/api/account/mfa/totp/confirm', { code: code() }, adminCookie);
    adminCookie = cookie(confirmed) ?? '';
    now = new Date(now.getTime() + 30_000);

    const missing = await recover(adminCookie);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'second_factor_required' });
    expect((await recover(adminCookie, { code: code() })).statusCode).toBe(201);
  });

  it('TOTP reset needs the user’s current password on completion', async () => {
    let bobCookie = await signIn('bob@example.org', BOB_PASSWORD);
    const setup = await post('/api/account/mfa/totp/setup', { password: BOB_PASSWORD }, bobCookie);
    const { secret } = setup.json<{ secret: string }>();
    const confirmed = await post(
      '/api/account/mfa/totp/confirm',
      { code: TOTP.generate({ secret: new TOTP({ secret }).secret, timestamp: now.getTime() }) },
      bobCookie,
    );
    bobCookie = cookie(confirmed) ?? '';

    expect((await recover(adminCookie, { resetPassword: false, resetTotp: true })).statusCode).toBe(201);
    const token = lastLink(RECOVER_LINK);
    expect((await post('/api/recoveries/resolve', { token })).json()).toMatchObject({ requiresCurrentPassword: true });
    const wrong = await post('/api/recoveries/complete', { token, currentPassword: 'not bobs password' });
    expect(wrong.statusCode).toBe(403);
    expect((await post('/api/recoveries/complete', { token, currentPassword: BOB_PASSWORD })).statusCode).toBe(204);

    expect((await get('/api/auth/session', bobCookie)).statusCode).toBe(401);
    // Sign-in no longer asks for a second factor.
    const fresh = await signIn('bob@example.org', BOB_PASSWORD);
    expect((await get('/api/account/mfa', fresh)).json()).toEqual({ totpEnabled: false, recoveryCodesRemaining: 0 });
  });

  describe('password change', () => {
    it('requires the current password and replaces all sessions', async () => {
      const first = await signIn('bob@example.org', BOB_PASSWORD);
      const second = await signIn('bob@example.org', BOB_PASSWORD);
      expect((await post('/api/account/password', { currentPassword: 'wrong wrong', newPassword: NEW_PASSWORD }, first)).statusCode).toBe(403);
      const weak = await post('/api/account/password', { currentPassword: BOB_PASSWORD, newPassword: 'short' }, first);
      expect(weak.json()).toEqual({ error: 'password_too_short', field: 'password' });

      const changed = await post('/api/account/password', { currentPassword: BOB_PASSWORD, newPassword: NEW_PASSWORD }, first);
      expect(changed.statusCode).toBe(204);
      expect((await get('/api/auth/session', first)).statusCode).toBe(401);
      expect((await get('/api/auth/session', second)).statusCode).toBe(401);
      expect((await get('/api/auth/session', cookie(changed))).statusCode).toBe(200);
      expect(logs).not.toContain(NEW_PASSWORD);
    });

    it('requires a session', async () => {
      expect((await post('/api/account/password', { currentPassword: BOB_PASSWORD, newPassword: NEW_PASSWORD })).statusCode).toBe(401);
    });
  });
});
