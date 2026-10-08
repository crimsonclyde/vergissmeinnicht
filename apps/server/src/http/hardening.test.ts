import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('limits the API but not the static web app files', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'vmn-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>VMN</title>');
    writeFileSync(join(dist, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const app = await buildApp({ webDistDir: dist });
    try {
      for (let i = 0; i < 320; i += 1) {
        expect((await app.inject({ url: i % 2 === 0 ? '/icon.svg' : '/w/some/page' })).statusCode).toBe(200);
      }
      let last = 0;
      for (let i = 0; i < 301; i += 1) last = (await app.inject({ url: '/api/health' })).statusCode;
      expect(last).toBe(429);
    } finally {
      await app.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('applies a configured global API limit (API_RATE_LIMIT_PER_MINUTE)', async () => {
    const app = await buildApp({ apiRateLimitPerMinute: 60 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 61; i += 1) statuses.push((await app.inject({ url: '/api/health' })).statusCode);
      expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
      expect(statuses[60]).toBe(429);
    } finally {
      await app.close();
    }
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

  it('reports a database migrated by a newer version as not ready (database_newer)', async () => {
    t = await startTestApp();
    t.database.sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('from-a-newer-version', (SELECT max(created_at) FROM __drizzle_migrations) + 86400000)").run();
    const newer = await t.get('/api/health/ready');
    expect(newer.statusCode).toBe(503);
    expect(newer.json()).toEqual({ status: 'not_ready', reason: 'database_newer' });
  });

  it('starts without any service on a newer database: health only, every API request refused with the reason', async () => {
    const app = await buildApp({ unavailable: { reason: 'database_newer' } });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      const ready = await app.inject({ method: 'GET', url: '/api/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({ status: 'not_ready', reason: 'database_newer' });
      for (const [method, url] of [['GET', '/api/workspaces'], ['POST', '/api/auth/sign-in'], ['POST', '/api/admin/workspace-restores'], ['GET', '/api/about']] as const) {
        const response = await app.inject(method === 'POST' ? { method, url, headers: { origin: 'http://localhost', 'content-type': 'application/json' }, payload: '{}' } : { method, url });
        expect(response.statusCode, url).toBe(503);
        expect(response.json()).toEqual({ error: 'database_newer' });
      }
    } finally {
      await app.close();
    }
  });
});
