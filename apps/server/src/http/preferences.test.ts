import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

describe('account preferences API (Step 8.7)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  beforeEach(async () => {
    t = await startTestApp();
    bob = await t.invite('bob@example.org', 'Bob');
  });
  afterEach(() => t.close());

  it('returns defaults, stores partial changes per account and follows the user to other sessions', async () => {
    expect((await t.get('/api/account/preferences', bob)).json()).toEqual({ preferences: { theme: 'system', criticalConfirm: 'hold' } });
    expect((await t.post('/api/account/preferences', { theme: 'memento-mori' }, bob)).json()).toEqual({
      preferences: { theme: 'memento-mori', criticalConfirm: 'hold' },
    });
    await t.post('/api/account/preferences', { criticalConfirm: 'tap-confirm' }, bob);
    const second = (await t.post('/api/auth/sign-in', { email: 'bob@example.org', password: 'correct horse battery staple' })).headers[
      'set-cookie'
    ];
    const cookie = [second ?? []].flat().find((c) => c.startsWith('__Secure-vmn.session_token='))?.split(';')[0] ?? '';
    expect((await t.get('/api/account/preferences', cookie)).json()).toEqual({
      preferences: { theme: 'memento-mori', criticalConfirm: 'tap-confirm' },
    });
    // Another account is unaffected.
    expect((await t.get('/api/account/preferences', t.admin)).json().preferences.theme).toBe('system');
  });

  it('validates strictly and requires a session and Origin', async () => {
    for (const body of [{}, { theme: 'neon' }, { criticalConfirm: 'none' }, { theme: 'dark', userId: 'x' }]) {
      expect((await t.post('/api/account/preferences', body, bob)).statusCode).toBe(400);
    }
    expect((await t.get('/api/account/preferences')).statusCode).toBe(401);
    expect((await t.post('/api/account/preferences', { theme: 'dark' })).statusCode).toBe(401);
    expect((await t.post('/api/account/preferences', { theme: 'dark' }, bob, null)).statusCode).toBe(403);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM user_preferences').get()).toEqual({ n: 0 });
  });
});
