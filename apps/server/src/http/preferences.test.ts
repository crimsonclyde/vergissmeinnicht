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
    expect((await t.get('/api/account/preferences', bob)).json()).toEqual({ preferences: { theme: 'system', criticalConfirm: 'hold', navigationOrder: null, privateGamification: true } });
    expect((await t.post('/api/account/preferences', { theme: 'memento-mori' }, bob)).json()).toEqual({
      preferences: { theme: 'memento-mori', criticalConfirm: 'hold', navigationOrder: null, privateGamification: true },
    });
    await t.post('/api/account/preferences', { criticalConfirm: 'tap-confirm' }, bob);
    const second = (await t.post('/api/auth/sign-in', { email: 'bob@example.org', password: 'violet anchor lantern marmalade' })).headers[
      'set-cookie'
    ];
    const cookie = [second ?? []].flat().find((c) => c.startsWith('__Secure-vmn.session_token='))?.split(';')[0] ?? '';
    expect((await t.get('/api/account/preferences', cookie)).json()).toEqual({
      preferences: { theme: 'memento-mori', criticalConfirm: 'tap-confirm', navigationOrder: null, privateGamification: true },
    });
    // Another account is unaffected.
    expect((await t.get('/api/account/preferences', t.admin)).json().preferences.theme).toBe('system');
  });

  it('accepts Tokyo Nights, and the database refuses an unknown theme even past the API (0049)', async () => {
    expect((await t.post('/api/account/preferences', { theme: 'tokyo-nights' }, bob)).json().preferences.theme).toBe('tokyo-nights');
    expect(() => t.database.sqlite.prepare("UPDATE user_preferences SET theme = 'neon'").run()).toThrow(/CHECK constraint failed/);
    expect((await t.get('/api/account/preferences', bob)).json().preferences.theme).toBe('tokyo-nights');
  });

  it('accepts Witch Forest (0050)', async () => {
    expect((await t.post('/api/account/preferences', { theme: 'witch-forest' }, bob)).json().preferences.theme).toBe('witch-forest');
    expect((await t.get('/api/account/preferences', bob)).json().preferences.theme).toBe('witch-forest');
  });

  it('stores an own-account order, preserves it on older partial updates, and resets explicitly', async () => {
    const navigationOrder = ['EQUIPMENT', 'JOURNAL', 'LISTS'];
    expect((await t.post('/api/account/preferences', { navigationOrder }, bob)).json().preferences.navigationOrder).toEqual(navigationOrder);
    await t.post('/api/account/preferences', { theme: 'dark' }, bob);
    expect((await t.get('/api/account/preferences', bob)).json().preferences.navigationOrder).toEqual(navigationOrder);
    expect((await t.get('/api/account/preferences', t.admin)).json().preferences.navigationOrder).toBeNull();
    const workspace = await t.createWorkspace('Order grants no access');
    await t.addMember(workspace, 'bob@example.org', 'GUEST');
    // Saving a disabled tool as a preference neither enables it nor grants a capability.
    expect((await t.get(`/api/workspaces/${workspace}/equipment`, bob)).statusCode).toBe(404);
    expect((await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Forbidden' }, bob)).statusCode).toBe(403);
    expect((await t.get('/api/account/preferences?userId=other', bob)).statusCode).toBe(400);
    expect((await t.post('/api/account/preferences', { navigationOrder, userId: 'other' }, bob)).statusCode).toBe(400);
    expect((await t.post('/api/account/preferences', { navigationOrder }, bob, null)).statusCode).toBe(403);
    expect((await t.post('/api/account/preferences', { navigationOrder })).statusCode).toBe(401);
    await t.post('/api/account/preferences', { navigationOrder: null, privateGamification: true }, bob);
    expect((await t.get('/api/account/preferences', bob)).json().preferences.navigationOrder).toBeNull();
  });

  it('refuses duplicate, structural, unknown and malformed orders at the API and database boundaries', async () => {
    for (const navigationOrder of [['LISTS', 'LISTS'], ['TODAY'], ['MORE'], ['GAMIFICATION'], ['MOON'], ['MAIL'], ['javascript:alert(1)'], [1], {}, 'LISTS', Array(10).fill('LISTS')]) {
      expect((await t.post('/api/account/preferences', { navigationOrder }, bob)).statusCode).toBe(400);
    }
    await t.post('/api/account/preferences', { navigationOrder: ['LISTS'] }, bob);
    for (const value of ['["LISTS","LISTS"]', '["MORE"]', '[1]', '{}', 'bad json']) {
      expect(() => t.database.sqlite.prepare('UPDATE user_preferences SET navigation_order=?').run(value)).toThrow();
    }
    expect((await t.get('/api/account/preferences', bob)).json().preferences.navigationOrder).toEqual(['LISTS']);
    const id = (await t.get('/api/auth/session', bob)).json().user.id as string;
    t.database.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(id);
    expect((await t.post('/api/account/preferences', { navigationOrder: ['EQUIPMENT'] }, bob)).statusCode).toBe(401);
  });

  it('validates strictly and requires a session and Origin', async () => {
    for (const body of [{}, { theme: 'neon' }, { theme: 'Tokyo Nights' }, { theme: 'tokyo_nights' }, { theme: 'Witch Forest' }, { theme: 'witch_forest' }, { criticalConfirm: 'none' }, { theme: 'dark', userId: 'x' }]) {
      expect((await t.post('/api/account/preferences', body, bob)).statusCode).toBe(400);
    }
    expect((await t.get('/api/account/preferences')).statusCode).toBe(401);
    expect((await t.post('/api/account/preferences', { theme: 'dark' })).statusCode).toBe(401);
    expect((await t.post('/api/account/preferences', { theme: 'dark' }, bob, null)).statusCode).toBe(403);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM user_preferences').get()).toEqual({ n: 0 });
  });
});
