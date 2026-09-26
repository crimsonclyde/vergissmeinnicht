import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapServerAdmin } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';
import { loggerOptions } from '../logging.ts';

const ORIGIN = 'https://vmn.example.org';
const PASSWORD = 'admin passphrase for tests';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const CHALLENGE_COOKIE = '__Secure-vmn.mfa_challenge';

type App = Awaited<ReturnType<typeof buildApp>>;
type Response = Awaited<ReturnType<App['inject']>>;

describe('TOTP HTTP API', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let app: App;
  let services: AppServices;
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

  const setCookies = (response: Response) => [response.headers['set-cookie'] ?? []].flat();
  function cookie(response: Response, name: string): string | undefined {
    const value = setCookies(response).find((c) => c.startsWith(`${name}=`));
    return value?.split(';')[0];
  }
  const post = (url: string, payload?: object, cookieHeader?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin: ORIGIN, ...(cookieHeader === undefined ? {} : { cookie: cookieHeader }) },
      ...(payload === undefined ? {} : { payload }),
    });
  const get = (url: string, cookieHeader?: string) =>
    app.inject({ method: 'GET', url, headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } });
  const signIn = () => post('/api/auth/sign-in', { email: 'admin@example.org', password: PASSWORD });
  const codeFor = (secret: string) => TOTP.generate({ secret: new TOTP({ secret }).secret, timestamp: now.getTime() });
  const nextStep = () => {
    now = new Date(now.getTime() + 30_000);
  };
  const sessionCount = () => (database.sqlite.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n;
  const events = () =>
    (database.sqlite.prepare('SELECT type, metadata FROM security_events ORDER BY rowid').all() as {
      type: string;
      metadata: string | null;
    }[]);

  async function signedIn(): Promise<string> {
    const response = await signIn();
    const session = cookie(response, SESSION_COOKIE);
    if (session === undefined) throw new Error(`no session cookie (status ${response.statusCode})`);
    return session;
  }

  /** Enables TOTP for the admin; returns the secret, recovery codes and the rotated session cookie. */
  async function enableTotp(session: string) {
    const setup = await post('/api/account/mfa/totp/setup', { password: PASSWORD }, session);
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json<{ secret: string; uri: string }>();
    const confirm = await post('/api/account/mfa/totp/confirm', { code: codeFor(secret) }, session);
    expect(confirm.statusCode).toBe(200);
    nextStep();
    const rotated = cookie(confirm, SESSION_COOKIE);
    if (rotated === undefined) throw new Error('session not rotated');
    return { secret, recoveryCodes: confirm.json<{ recoveryCodes: string[] }>().recoveryCodes, session: rotated };
  }

  /** Password step for a TOTP account; returns the challenge cookie. */
  async function passwordStep(): Promise<string> {
    const response = await signIn();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mfaRequired: true });
    const challenge = cookie(response, CHALLENGE_COOKIE);
    if (challenge === undefined) throw new Error('no challenge cookie');
    return challenge;
  }

  beforeEach(async () => {
    database = createTestDatabase();
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
        services = { ...built, mfa: { ...built.mfa, clock: { now: () => now } } };
        return services;
      },
    });
    const { acceptUrl } = await bootstrapServerAdmin(services.invitations, { email: normalizeEmail('admin@example.org') });
    const token = /\/invite\/([A-Za-z0-9_-]{43})/.exec(acceptUrl)?.[1];
    expect((await post('/api/invitations/accept', { token, displayName: 'Ada', password: PASSWORD })).statusCode).toBe(201);
  });

  afterEach(async () => {
    await app.close();
    database.dispose();
  });

  describe('enrollment', () => {
    it('requires a session and the current password', async () => {
      expect((await post('/api/account/mfa/totp/setup', { password: PASSWORD })).statusCode).toBe(401);
      const session = await signedIn();
      const wrong = await post('/api/account/mfa/totp/setup', { password: 'not my password at all' }, session);
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json()).toEqual({ error: 'reauthentication_failed' });
      expect((await get('/api/account/mfa', session)).json()).toEqual({ totpEnabled: false, recoveryCodesRemaining: 0 });
    });

    it('activates only after a valid code and then ends every other session', async () => {
      const session = await signedIn();
      const otherDevice = await signedIn();
      const setup = await post('/api/account/mfa/totp/setup', { password: PASSWORD }, session);
      const { secret, uri } = setup.json<{ secret: string; uri: string }>();
      expect(uri.startsWith('otpauth://totp/')).toBe(true);

      const bad = await post('/api/account/mfa/totp/confirm', { code: '000000' }, session);
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({ error: 'invalid_code' });
      expect((await get('/api/account/mfa', session)).json()).toMatchObject({ totpEnabled: false });

      const confirm = await post('/api/account/mfa/totp/confirm', { code: codeFor(secret) }, session);
      expect(confirm.statusCode).toBe(200);
      expect(confirm.json<{ recoveryCodes: string[] }>().recoveryCodes).toHaveLength(10);
      const rotated = cookie(confirm, SESSION_COOKIE);
      expect(rotated).toBeDefined();
      expect((await get('/api/auth/session', session)).statusCode).toBe(401);
      expect((await get('/api/auth/session', otherDevice)).statusCode).toBe(401);
      expect((await get('/api/account/mfa', rotated)).json()).toEqual({ totpEnabled: true, recoveryCodesRemaining: 10 });
      expect(sessionCount()).toBe(1);
    });
  });

  describe('sign-in of a TOTP account', () => {
    it('creates no session before the challenge and sets a narrowly scoped challenge cookie', async () => {
      const { session } = await enableTotp(await signedIn());
      await post('/api/auth/sign-out', undefined, session);
      expect(sessionCount()).toBe(0);

      const response = await signIn();
      expect(response.json()).toEqual({ mfaRequired: true });
      expect(cookie(response, SESSION_COOKIE)).toBeUndefined();
      expect(sessionCount()).toBe(0);
      const raw = setCookies(response).find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`)) ?? '';
      expect(raw).toMatch(/; Path=\/api\/auth\/mfa(;|$)/);
      expect(raw).toMatch(/; HttpOnly/);
      expect(raw).toMatch(/; Secure/);
      expect(raw).toMatch(/; SameSite=Strict/);
      expect(raw).toMatch(/; Max-Age=300/);
    });

    it('grants no access to authenticated routes with only the challenge', async () => {
      const { secret } = await enableTotp(await signedIn());
      const challenge = await passwordStep();
      const challengeValue = challenge.split('=')[1] ?? '';
      // The challenge cookie, or its value dressed up as a session cookie, is not a session.
      for (const attempt of [challenge, `${SESSION_COOKIE}=${challengeValue}`]) {
        expect((await get('/api/auth/session', attempt)).statusCode).toBe(401);
        expect((await get('/api/account/mfa', attempt)).statusCode).toBe(401);
        expect((await get('/api/admin/invitations', attempt)).statusCode).toBe(401);
        expect((await post('/api/admin/invitations', { email: 'eve@example.org' }, attempt)).statusCode).toBe(401);
        expect((await post('/api/account/mfa/totp/disable', { password: PASSWORD, code: codeFor(secret) }, attempt)).statusCode).toBe(401);
      }
    });

    it('cannot be skipped with client-supplied flags', async () => {
      await enableTotp(await signedIn());
      const flagged = await post('/api/auth/sign-in', { email: 'admin@example.org', password: PASSWORD, mfaVerified: true });
      expect(flagged.statusCode).toBe(400);
      expect(cookie(flagged, SESSION_COOKIE)).toBeUndefined();
      const noChallenge = await post('/api/auth/mfa', { code: '123456' });
      expect(noChallenge.statusCode).toBe(401);
      expect(noChallenge.json()).toEqual({ error: 'mfa_challenge_invalid' });
      const forged = await post('/api/auth/mfa', { code: '123456' }, `${CHALLENGE_COOKIE}=${'A'.repeat(43)}`);
      expect(forged.statusCode).toBe(401);
    });

    it('issues a full session after a valid code, once', async () => {
      const { secret } = await enableTotp(await signedIn());
      const challenge = await passwordStep();
      const code = codeFor(secret);
      const response = await post('/api/auth/mfa', { code }, challenge);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ user: { email: 'admin@example.org' } });
      const session = cookie(response, SESSION_COOKIE);
      expect((await get('/api/auth/session', session)).statusCode).toBe(200);
      expect(cookie(response, CHALLENGE_COOKIE)).toBe(`${CHALLENGE_COOKIE}=`);
      expect((await post('/api/auth/mfa', { code }, challenge)).statusCode).toBe(401);

      const login = events().filter((e) => e.type === 'LOGIN_SUCCEEDED').at(-1);
      expect(JSON.parse(login?.metadata ?? '{}')).toMatchObject({ method: 'totp' });
      expect(events().map((e) => e.type)).toContain('MFA_CHALLENGE_STARTED');
    });

    it('accepts a recovery code once', async () => {
      const { recoveryCodes } = await enableTotp(await signedIn());
      const code = recoveryCodes[0] ?? '';
      const response = await post('/api/auth/mfa', { recoveryCode: code.toUpperCase() }, await passwordStep());
      expect(response.statusCode).toBe(200);
      const session = cookie(response, SESSION_COOKIE);
      expect((await get('/api/account/mfa', session)).json()).toEqual({ totpEnabled: true, recoveryCodesRemaining: 9 });
      expect((await post('/api/auth/mfa', { recoveryCode: code }, await passwordStep())).statusCode).toBe(400);
    });

    it('ends the challenge after five wrong codes', async () => {
      const { secret } = await enableTotp(await signedIn());
      const challenge = await passwordStep();
      for (let i = 0; i < 5; i++) {
        const wrong = await post('/api/auth/mfa', { code: '000000' }, challenge);
        expect(wrong.statusCode).toBe(400);
      }
      const late = await post('/api/auth/mfa', { code: codeFor(secret) }, challenge);
      expect(late.statusCode).toBe(401);
      expect(late.json()).toEqual({ error: 'mfa_challenge_invalid' });
    });

    it('rejects a code already used for this account (replay)', async () => {
      const { secret } = await enableTotp(await signedIn());
      const code = codeFor(secret);
      expect((await post('/api/auth/mfa', { code }, await passwordStep())).statusCode).toBe(200);
      expect((await post('/api/auth/mfa', { code }, await passwordStep())).statusCode).toBe(400);
    });

    it('fails when the account was disabled after the password step', async () => {
      const { secret } = await enableTotp(await signedIn());
      const challenge = await passwordStep();
      database.sqlite.prepare("UPDATE users SET status = 'DISABLED'").run();
      const before = sessionCount();
      expect((await post('/api/auth/mfa', { code: codeFor(secret) }, challenge)).statusCode).toBe(401);
      expect(sessionCount()).toBe(before);
    });
  });

  describe('disable and recovery codes', () => {
    it('disable requires password and a second factor, then ends other sessions', async () => {
      const { secret, session } = await enableTotp(await signedIn());
      expect((await post('/api/account/mfa/totp/disable', { password: PASSWORD }, session)).statusCode).toBe(400);
      expect((await post('/api/account/mfa/totp/disable', { password: 'wrong wrong wrong', code: codeFor(secret) }, session)).statusCode).toBe(403);
      expect((await post('/api/account/mfa/totp/disable', { password: PASSWORD, code: '000000' }, session)).statusCode).toBe(400);

      const disabled = await post('/api/account/mfa/totp/disable', { password: PASSWORD, code: codeFor(secret) }, session);
      expect(disabled.statusCode).toBe(204);
      expect((await get('/api/auth/session', session)).statusCode).toBe(401);
      const rotated = cookie(disabled, SESSION_COOKIE);
      expect((await get('/api/account/mfa', rotated)).json()).toEqual({ totpEnabled: false, recoveryCodesRemaining: 0 });
      expect(cookie(await signIn(), SESSION_COOKIE)).toBeDefined();
      expect(events().map((e) => e.type)).toContain('TOTP_DISABLED');
    });

    it('regeneration requires the password and replaces all codes', async () => {
      const { recoveryCodes, session } = await enableTotp(await signedIn());
      expect((await post('/api/account/mfa/recovery-codes', { password: 'wrong wrong wrong' }, session)).statusCode).toBe(403);
      const fresh = await post('/api/account/mfa/recovery-codes', { password: PASSWORD }, session);
      expect(fresh.statusCode).toBe(200);
      expect((await post('/api/auth/mfa', { recoveryCode: recoveryCodes[0] }, await passwordStep())).statusCode).toBe(400);
      const next = fresh.json<{ recoveryCodes: string[] }>().recoveryCodes[0];
      expect((await post('/api/auth/mfa', { recoveryCode: next }, await passwordStep())).statusCode).toBe(200);
    });
  });

  it('never logs TOTP secrets, codes or recovery codes', async () => {
    const { secret, recoveryCodes } = await enableTotp(await signedIn());
    const challenge = await passwordStep();
    const code = codeFor(secret);
    await post('/api/auth/mfa', { code }, challenge);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(code);
    expect(logs).not.toContain(challenge.split('=')[1]);
    for (const recoveryCode of recoveryCodes) expect(logs).not.toContain(recoveryCode);
    expect(logs).not.toContain(PASSWORD);
  });
});
