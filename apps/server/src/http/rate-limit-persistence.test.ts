import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, startTestApp } from './test-harness.ts';

describe('persistent rate limits (Step 2.9)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeEach(async () => {
    t = await startTestApp();
  });
  afterEach(() => t.close());

  it('keeps the per-account sign-in limit across a restart and stores no email address', async () => {
    const attempt = () => t.post('/api/auth/sign-in', { email: 'admin@example.org', password: 'wrong password 123456' });
    // The harness already signed in once; 10 per 15 minutes per account.
    for (let i = 0; i < 9; i += 1) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);

    await t.restart();
    expect((await attempt()).statusCode).toBe(429);
    expect((await t.post('/api/auth/sign-in', { email: 'admin@example.org', password: PASSWORD })).statusCode).toBe(429);
    // The per-client limit (10 per minute) persisted as well: this address is blocked for every account.
    expect((await t.post('/api/auth/sign-in', { email: 'someone@example.org', password: PASSWORD })).statusCode).toBe(429);

    const rows = t.database.sqlite.prepare('SELECT key_hash FROM rate_limits').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/admin|example|127\.0\.0\.1/);
  });

  it('keeps ordinary limits in memory only', async () => {
    const before = (t.database.sqlite.prepare('SELECT count(*) AS n FROM rate_limits').get() as { n: number }).n;
    for (let i = 0; i < 5; i += 1) await t.get('/api/workspaces', t.admin);
    expect((t.database.sqlite.prepare('SELECT count(*) AS n FROM rate_limits').get() as { n: number }).n).toBe(before);
  });
});
