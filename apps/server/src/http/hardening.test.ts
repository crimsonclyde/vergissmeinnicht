import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ORIGIN, startTestApp } from './test-harness.ts';

describe('production hardening (10.3)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>> | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it('sends HSTS only when configured, and a restrictive Permissions-Policy', async () => {
    const withHsts = await buildApp({ hstsMaxAge: 31_536_000 });
    const response = await withHsts.inject({ url: '/api/health' });
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['permissions-policy']).toContain('geolocation=()');
    await withHsts.close();
    const without = await buildApp();
    expect((await without.inject({ url: '/api/health' })).headers['strict-transport-security']).toBeUndefined();
    await without.close();
  });

  it('counts rate limits per real client behind a trusted proxy and ignores spoofed headers otherwise', async () => {
    t = await startTestApp({ trustedProxies: ['10.0.0.2'] });
    const app = t.app;
    // One account per client, so only the per-client limit is exercised.
    const signIn = (remoteAddress: string, forwardedFor?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        remoteAddress,
        headers: { origin: ORIGIN, ...(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }) },
        payload: { email: `${forwardedFor ?? remoteAddress}@example.org`.replace(/[^a-z0-9@.]/g, 'x'), password: 'wrong password, wrong password' },
      });
    // Ten attempts per minute and client (auth routes); the proxy forwards client A.
    for (let i = 0; i < 10; i += 1) expect((await signIn('10.0.0.2', '203.0.113.10')).statusCode).toBe(401);
    expect((await signIn('10.0.0.2', '203.0.113.10')).statusCode).toBe(429);
    // Client B behind the same proxy is not affected.
    expect((await signIn('10.0.0.2', '203.0.113.20')).statusCode).toBe(401);
    // A client that is not the proxy cannot escape its own limit by sending X-Forwarded-For.
    for (let i = 0; i < 10; i += 1) await signIn('198.51.100.7', `192.0.2.${i}`);
    expect((await signIn('198.51.100.7', '192.0.2.99')).statusCode).toBe(429);
  });

  it('reports readiness, including pending migrations, without details', async () => {
    t = await startTestApp();
    expect((await t.get('/api/health/ready')).json()).toEqual({ status: 'ready' });
    t.database.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)').run();
    const pending = await t.get('/api/health/ready');
    expect(pending.statusCode).toBe(503);
    expect(pending.json()).toEqual({ status: 'not_ready', reason: 'migrations_pending' });
  });
});
