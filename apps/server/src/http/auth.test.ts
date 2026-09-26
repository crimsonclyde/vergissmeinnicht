import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapServerAdmin, type EmailMessage } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';
import { loggerOptions } from '../logging.ts';

const ORIGIN = 'https://vmn.example.org';
const LINK = /\/invite\/([A-Za-z0-9_-]{43})/;
const ADMIN_PASSWORD = 'admin passphrase for tests';
const BOB_PASSWORD = 'bob chooses a long passphrase';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const DAY_MS = 86_400_000;

type App = Awaited<ReturnType<typeof buildApp>>;
interface RequestExtras {
  readonly headers?: Record<string, string>;
  readonly remoteAddress?: string;
}

describe('authentication and invitation HTTP API', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let app: App;
  let outbox: EmailMessage[];
  let logs: string;

  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: ORIGIN,
    DATABASE_PATH: '/unused/by/tests.sqlite',
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    SMTP_HOST: '127.0.0.1',
    MAIL_FROM_ADDRESS: 'noreply@example.org',
    LOG_LEVEL: 'info',
  });

  const post = (url: string, payload?: object, extra: RequestExtras = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin: ORIGIN, ...extra.headers },
      ...(payload === undefined ? {} : { payload }),
      ...(extra.remoteAddress === undefined ? {} : { remoteAddress: extra.remoteAddress }),
    });
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });

  function sessionCookie(response: Awaited<ReturnType<App['inject']>>): string {
    const raw = [response.headers['set-cookie'] ?? []].flat();
    const session = raw.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    if (session === undefined) throw new Error(`no session cookie (status ${response.statusCode})`);
    return session.split(';')[0] ?? '';
  }
  const signIn = (email: string, password: string, extra: RequestExtras = {}) =>
    post('/api/auth/sign-in', { email, password }, extra);
  const eventTypes = () =>
    (database.sqlite.prepare('SELECT type FROM security_events ORDER BY rowid').all() as { type: string }[]).map(
      (row) => row.type,
    );
  const sessionCount = () => (database.sqlite.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n;
  const lastInviteToken = () => LINK.exec(outbox.at(-1)?.text ?? '')?.[1] ?? '';

  /** Bootstraps and accepts the first server admin over HTTP; returns the admin's session cookie. */
  async function setUpAdmin(): Promise<string> {
    const { acceptUrl } = await bootstrapServerAdmin(services.invitations, {
      email: normalizeEmail('admin@example.org'),
    });
    const token = LINK.exec(acceptUrl)?.[1] ?? '';
    const accepted = await post('/api/invitations/accept', { token, displayName: 'Ada Admin', password: ADMIN_PASSWORD });
    expect(accepted.statusCode).toBe(201);
    return sessionCookie(await signIn('admin@example.org', ADMIN_PASSWORD));
  }

  async function inviteAndAccept(adminCookie: string, email = 'bob@example.org'): Promise<void> {
    const issued = await post('/api/admin/invitations', { email }, { headers: { cookie: adminCookie } });
    expect(issued.statusCode).toBe(201);
    const accepted = await post('/api/invitations/accept', {
      token: lastInviteToken(),
      displayName: 'Bob',
      password: BOB_PASSWORD,
    });
    expect(accepted.statusCode).toBe(201);
  }

  let services: AppServices;
  function servicesFor(db: typeof database, log: FastifyBaseLogger): AppServices {
    const built = createServices(config, db)(log);
    const email = {
      async send(message: EmailMessage) {
        outbox.push(message);
      },
    };
    return { ...built, invitations: { ...built.invitations, email } };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    outbox = [];
    logs = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += String(chunk);
        callback();
      },
    });
    app = await buildApp({
      logger: { ...loggerOptions('info'), stream },
      services: (log) => (services = servicesFor(database, log)),
    });
  });

  afterEach(async () => {
    await app.close();
    database.dispose();
  });

  describe('invitation acceptance', () => {
    it('resolves, accepts once and never logs the token or password', async () => {
      await setUpAdmin();
      const adminCookie = sessionCookie(await signIn('admin@example.org', ADMIN_PASSWORD));
      await post('/api/admin/invitations', { email: 'Bob@Example.org' }, { headers: { cookie: adminCookie } });
      const token = lastInviteToken();

      const resolved = await post('/api/invitations/resolve', { token });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json()).toMatchObject({ email: 'bob@example.org' });

      const body = { token, displayName: 'Bob', password: BOB_PASSWORD };
      expect((await post('/api/invitations/accept', body)).statusCode).toBe(201);
      const replay = await post('/api/invitations/accept', { ...body, displayName: 'Mallory' });
      expect(replay.statusCode).toBe(404);
      expect(replay.json()).toEqual({ error: 'invalid_invitation' });
      expect((await post('/api/invitations/resolve', { token })).statusCode).toBe(404);

      expect(logs).not.toContain(token);
      expect(logs).not.toContain(BOB_PASSWORD);
      expect(logs).not.toContain(ADMIN_PASSWORD);
    });

    it('does not create a session on acceptance', async () => {
      const { acceptUrl } = await bootstrapServerAdmin(services.invitations, {
        email: normalizeEmail('admin@example.org'),
      });
      const response = await post('/api/invitations/accept', {
        token: LINK.exec(acceptUrl)?.[1],
        displayName: 'Ada',
        password: ADMIN_PASSWORD,
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(sessionCount()).toBe(0);
    });

    it('reports weak passwords with a stable code and keeps the invitation usable', async () => {
      const { acceptUrl } = await bootstrapServerAdmin(services.invitations, {
        email: normalizeEmail('admin@example.org'),
      });
      const token = LINK.exec(acceptUrl)?.[1];
      const weak = await post('/api/invitations/accept', { token, displayName: 'Ada', password: 'too-short' });
      expect(weak.statusCode).toBe(400);
      expect(weak.json()).toEqual({ error: 'password_too_short', field: 'password' });
      expect((await post('/api/invitations/resolve', { token })).statusCode).toBe(200);
    });

    it.each([
      ['unknown token', { token: 'A'.repeat(43), displayName: 'X', password: BOB_PASSWORD }, 404],
      ['malformed token', { token: '../../etc', displayName: 'X', password: BOB_PASSWORD }, 404],
      ['unexpected field', { token: 'A'.repeat(43), displayName: 'X', password: BOB_PASSWORD, serverAdmin: true }, 400],
      ['missing field', { token: 'A'.repeat(43) }, 400],
    ])('rejects %s', async (_label, payload, status) => {
      expect((await post('/api/invitations/accept', payload)).statusCode).toBe(status);
    });
  });

  describe('sign-in', () => {
    it('issues a strict, secure, HttpOnly session cookie and no token in the body', async () => {
      await setUpAdmin();
      const response = await signIn('  ADMIN@example.org ', ADMIN_PASSWORD);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        user: { id: expect.any(String), email: 'admin@example.org', displayName: 'Ada Admin', serverAdmin: true },
      });
      const cookie = [response.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; Secure/i);
      expect(cookie).toMatch(/; SameSite=Strict/i);
      expect(cookie).toMatch(/; Path=\//i);
      expect(cookie).not.toMatch(/; Domain=/i);
      const token = (database.sqlite.prepare('SELECT token FROM sessions').all() as { token: string }[]).map((r) => r.token);
      for (const value of token) expect(response.body).not.toContain(value);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('answers unknown email, wrong password and malformed email identically', async () => {
      await setUpAdmin();
      const responses = await Promise.all([
        signIn('admin@example.org', 'wrong passphrase entirely'),
        signIn('nobody@example.org', ADMIN_PASSWORD),
        signIn('not an email', ADMIN_PASSWORD),
        signIn('admin@example.org', 'x'.repeat(200)),
      ]);
      for (const response of responses) {
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'invalid_credentials' });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      // Failures against an existing account are audited; unknown identifiers are not stored.
      expect(eventTypes().filter((type) => type === 'LOGIN_FAILED')).toHaveLength(2);
      expect(JSON.stringify(database.sqlite.prepare('SELECT * FROM security_events').all())).not.toContain('nobody@');
      expect(logs).not.toContain('wrong passphrase entirely');
      expect(logs).not.toContain('nobody@example.org');
    });

    it('audits successful logins with the session id', async () => {
      await setUpAdmin();
      const event = database.sqlite
        .prepare("SELECT actor_label, metadata FROM security_events WHERE type = 'LOGIN_SUCCEEDED'")
        .get() as { actor_label: string; metadata: string };
      const sessionId = (database.sqlite.prepare('SELECT id FROM sessions').get() as { id: string }).id;
      expect(event.actor_label).toBe('Ada Admin');
      expect(JSON.parse(event.metadata)).toEqual({ sessionId });
    });

    it('rotates the session: an existing session is revoked by a new login', async () => {
      const first = await setUpAdmin();
      const second = sessionCookie(await signIn('admin@example.org', ADMIN_PASSWORD, { headers: { cookie: first } }));
      expect(second).not.toBe(first);
      expect((await get('/api/auth/session', first)).statusCode).toBe(401);
      expect((await get('/api/auth/session', second)).statusCode).toBe(200);
      expect(sessionCount()).toBe(1);
    });

    it('ignores a callbackURL and other unexpected fields', async () => {
      await setUpAdmin();
      const response = await post('/api/auth/sign-in', {
        email: 'admin@example.org',
        password: ADMIN_PASSWORD,
        callbackURL: 'https://evil.example',
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers.location).toBeUndefined();
    });

    it('refuses DISABLED users and revokes their existing sessions', async () => {
      const adminCookie = await setUpAdmin();
      database.sqlite.prepare("UPDATE users SET status = 'DISABLED'").run();
      expect((await get('/api/auth/session', adminCookie)).statusCode).toBe(401);
      expect(sessionCount()).toBe(0);
      const response = await signIn('admin@example.org', ADMIN_PASSWORD);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
      expect(sessionCount()).toBe(0);
    });

    it('rate-limits sign-in attempts per client address', async () => {
      await setUpAdmin();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await signIn(`guess${i}@example.org`, 'wrong passphrase entirely', { remoteAddress: '192.0.2.7' })).statusCode);
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('rate-limits sign-in attempts per account across client addresses', async () => {
      await setUpAdmin();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await signIn('ADMIN@example.org', 'wrong passphrase entirely', { remoteAddress: `198.51.100.${i + 1}` })).statusCode);
      }
      expect(statuses[10]).toBe(429);
      // The limit also holds for the correct password from yet another address.
      expect((await signIn('admin@example.org', ADMIN_PASSWORD, { remoteAddress: '203.0.113.9' })).statusCode).toBe(429);
    });
  });

  describe('Better Auth surface', () => {
    it.each([
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/sign-in/email'],
      ['GET', '/api/auth/get-session'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/change-email'],
      ['POST', '/api/auth/change-password'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/delete-user'],
      ['GET', '/api/auth/list-sessions'],
      ['GET', '/api/auth/list-accounts'],
      ['POST', '/api/auth/link-social'],
    ] as const)('does not expose %s %s', async (method, url) => {
      const cookie = await setUpAdmin();
      const response = await app.inject({
        method,
        url,
        headers: { origin: ORIGIN, cookie },
        ...(method === 'POST' ? { payload: { email: 'eve@example.org', password: 'x'.repeat(20), name: 'Eve' } } : {}),
      });
      expect(response.statusCode).toBe(404);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    });
  });

  describe('sessions', () => {
    it('rejects missing, tampered and unsigned session cookies', async () => {
      const cookie = await setUpAdmin();
      expect((await get('/api/auth/session')).statusCode).toBe(401);
      const [name, value = ''] = cookie.split('=');
      const tampered = `${name}=${value.slice(0, -3)}${value.endsWith('abc') ? 'xyz' : 'abc'}`;
      expect((await get('/api/auth/session', tampered)).statusCode).toBe(401);
      // A token read from the database is useless without the AUTH_SECRET signature.
      const { token } = database.sqlite.prepare('SELECT token FROM sessions').get() as { token: string };
      expect((await get('/api/auth/session', `${SESSION_COOKIE}=${token}`)).statusCode).toBe(401);
      expect((await get('/api/auth/session', cookie)).statusCode).toBe(200);
    });

    it('ends sessions past the absolute lifetime even when active', async () => {
      const cookie = await setUpAdmin();
      database.sqlite.prepare('UPDATE sessions SET created_at = ?').run(Date.now() - 30 * DAY_MS - 1000);
      expect((await get('/api/auth/session', cookie)).statusCode).toBe(401);
      expect(sessionCount()).toBe(0);
    });

    it('ends idle sessions', async () => {
      const cookie = await setUpAdmin();
      database.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
      expect((await get('/api/auth/session', cookie)).statusCode).toBe(401);
    });

    it('signs out server-side and audits it', async () => {
      const cookie = await setUpAdmin();
      const response = await post('/api/auth/sign-out', undefined, { headers: { cookie } });
      expect(response.statusCode).toBe(204);
      expect(sessionCount()).toBe(0);
      expect((await get('/api/auth/session', cookie)).statusCode).toBe(401);
      expect(eventTypes()).toContain('LOGOUT');
    });
  });

  describe('CSRF / origin protection', () => {
    it.each([
      ['missing', undefined],
      ['foreign', 'https://evil.example'],
      ['null', 'null'],
      ['scheme mismatch', 'http://vmn.example.org'],
    ])('rejects state-changing requests with a %s Origin', async (_label, origin) => {
      const cookie = await setUpAdmin();
      const headers: Record<string, string> = { cookie };
      if (origin !== undefined) headers.origin = origin;
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: '/api/auth/sign-out', headers }),
        app.inject({ method: 'POST', url: '/api/admin/invitations', headers, payload: { email: 'x@example.org' } }),
        app.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers,
          payload: { email: 'admin@example.org', password: ADMIN_PASSWORD },
        }),
      ]);
      for (const response of responses) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'forbidden_origin' });
      }
      expect(sessionCount()).toBe(1);
      expect(outbox).toHaveLength(0);
    });

    it('accepts only JSON bodies', async () => {
      await setUpAdmin();
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { origin: ORIGIN, 'content-type': 'text/plain' },
        payload: JSON.stringify({ email: 'admin@example.org', password: ADMIN_PASSWORD }),
      });
      expect(response.statusCode).toBe(415);
    });
  });

  describe('server-admin invitation endpoints', () => {
    it('require authentication', async () => {
      expect((await get('/api/admin/invitations')).statusCode).toBe(401);
      expect((await post('/api/admin/invitations', { email: 'x@example.org' })).statusCode).toBe(401);
    });

    it('are forbidden for a non-admin user', async () => {
      const adminCookie = await setUpAdmin();
      await inviteAndAccept(adminCookie);
      const bobCookie = sessionCookie(await signIn('bob@example.org', BOB_PASSWORD));
      const sent = outbox.length;

      expect((await get('/api/admin/invitations', bobCookie)).statusCode).toBe(403);
      const issue = await post(
        '/api/admin/invitations',
        { email: 'eve@example.org', grantsServerAdmin: true },
        { headers: { cookie: bobCookie } },
      );
      expect(issue.statusCode).toBe(403);
      expect(outbox).toHaveLength(sent);

      const pending = await post('/api/admin/invitations', { email: 'carol@example.org' }, { headers: { cookie: adminCookie } });
      const { id } = pending.json<{ invitation: { id: string } }>().invitation;
      expect((await post(`/api/admin/invitations/${id}/revoke`, undefined, { headers: { cookie: bobCookie } })).statusCode).toBe(403);
    });

    it('let a server admin issue, list and revoke invitations', async () => {
      const cookie = await setUpAdmin();
      const issued = await post('/api/admin/invitations', { email: 'carol@example.org' }, { headers: { cookie } });
      expect(issued.statusCode).toBe(201);
      const body = issued.json<{ invitation: { id: string }; delivery: string }>();
      expect(body.delivery).toBe('sent');
      expect(issued.body).not.toContain(lastInviteToken());
      expect(outbox.at(-1)?.to).toBe('carol@example.org');

      const listed = await get('/api/admin/invitations', cookie);
      expect(listed.json<{ invitations: { id: string }[] }>().invitations.map((i) => i.id)).toEqual([body.invitation.id]);
      expect(listed.body).not.toContain(lastInviteToken());

      const url = `/api/admin/invitations/${body.invitation.id}/revoke`;
      expect((await post(url, undefined, { headers: { cookie } })).statusCode).toBe(204);
      expect((await post(url, undefined, { headers: { cookie } })).statusCode).toBe(409);
      expect((await post('/api/invitations/resolve', { token: lastInviteToken() })).statusCode).toBe(404);
      expect((await post('/api/admin/invitations/not-a-uuid/revoke', undefined, { headers: { cookie } })).statusCode).toBe(400);
    });

    it('refuse to invite an existing account', async () => {
      const cookie = await setUpAdmin();
      const response = await post('/api/admin/invitations', { email: 'ADMIN@example.org' }, { headers: { cookie } });
      expect(response.statusCode).toBe(409);
    });
  });
});
