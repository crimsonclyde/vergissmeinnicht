import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, startTestApp } from './test-harness.ts';

describe('server-admin account status API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let bobId: string;

  beforeEach(async () => {
    t = await startTestApp();
    bob = await t.invite('bob@example.org', 'Bob');
    bobId = ((await t.get('/api/auth/session', bob)).json() as { user: { id: string } }).user.id;
  });
  afterEach(() => t.close());

  const setStatus = (userId: string, status: string, cookie = t.admin, extra: object = {}) =>
    t.post(`/api/admin/accounts/${userId}/status`, { status, password: PASSWORD, ...extra }, cookie);

  it('lists accounts for server admins only', async () => {
    const listed = await t.get('/api/admin/accounts', t.admin);
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { accounts: { email: string; status: string; totpEnabled: boolean }[] }).accounts).toEqual([
      expect.objectContaining({ email: 'admin@example.org', status: 'ACTIVE', serverAdmin: true, totpEnabled: false }),
      expect.objectContaining({ email: 'bob@example.org', status: 'ACTIVE', serverAdmin: false }),
    ]);
    expect((await t.get('/api/admin/accounts', bob)).statusCode).toBe(403);
    expect((await t.get('/api/admin/accounts')).statusCode).toBe(401);
  });

  it('disabling ends the session at once; re-enabling does not bring it back', async () => {
    expect((await t.get('/api/workspaces', bob)).statusCode).toBe(200);
    const disabled = await setStatus(bobId, 'DISABLED');
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ status: 'DISABLED', sessionsRevoked: 1 });
    expect((await t.get('/api/workspaces', bob)).statusCode).toBe(401);
    expect((await t.post('/api/auth/sign-in', { email: 'bob@example.org', password: PASSWORD })).statusCode).toBe(401);

    expect((await setStatus(bobId, 'ACTIVE')).statusCode).toBe(200);
    expect((await t.get('/api/workspaces', bob)).statusCode).toBe(401);
    expect((await t.post('/api/auth/sign-in', { email: 'bob@example.org', password: PASSWORD })).statusCode).toBe(200);
  });

  it('refuses without session, Origin, admin flag or correct step-up', async () => {
    const adminId = ((await t.get('/api/auth/session', t.admin)).json() as { user: { id: string } }).user.id;
    expect((await t.post(`/api/admin/accounts/${bobId}/status`, { status: 'DISABLED', password: PASSWORD })).statusCode).toBe(401);
    expect((await t.post(`/api/admin/accounts/${bobId}/status`, { status: 'DISABLED', password: PASSWORD }, t.admin, null)).statusCode).toBe(403);
    expect((await setStatus(adminId, 'DISABLED', bob)).statusCode).toBe(403);
    expect((await setStatus(adminId, 'DISABLED')).json()).toEqual({ error: 'forbidden' });
    const wrong = await setStatus(bobId, 'DISABLED', t.admin, { password: 'not the admin password' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'reauthentication_failed' });
    expect((await t.get('/api/workspaces', bob)).statusCode).toBe(200);
  });

  it('validates input strictly and reports unknown, unchanged and sole-admin cases', async () => {
    expect((await setStatus('not-a-uuid', 'DISABLED')).statusCode).toBe(400);
    expect((await setStatus(bobId, 'DELETED')).statusCode).toBe(400);
    expect((await setStatus(bobId, 'DISABLED', t.admin, { extra: true })).statusCode).toBe(400);
    expect((await setStatus(bobId, 'DISABLED', t.admin, { code: '123456', recoveryCode: 'x' })).statusCode).toBe(400);
    expect((await setStatus('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', 'DISABLED')).json()).toEqual({ error: 'unknown_account' });
    expect((await setStatus(bobId, 'ACTIVE')).json()).toEqual({ error: 'account_status_unchanged' });

    const workspaceId = await t.createWorkspace('Garage');
    await t.addMember(workspaceId, 'bob@example.org', 'ADMIN');
    // The only other ADMIN leaves: Bob is now the Workspace's only manager.
    expect((await t.post(`/api/workspaces/${workspaceId}/leave`, undefined, t.admin)).statusCode).toBe(204);
    const refused = await setStatus(bobId, 'DISABLED');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'sole_workspace_admin', workspaces: [{ id: workspaceId, name: 'Garage' }] });
    expect((await t.get('/api/workspaces', bob)).statusCode).toBe(200);
  });

  it('rate-limits status changes per admin', async () => {
    let last = 0;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = (await setStatus(bobId, 'DISABLED', t.admin, { password: 'wrong wrong wrong wrong' })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('serves the security log to server admins only, without secrets', async () => {
    await setStatus(bobId, 'DISABLED');
    const log = await t.get('/api/admin/security-events', t.admin);
    expect(log.statusCode).toBe(200);
    const body = log.json() as { events: { type: string; subjectEmail: string | null; actor: string }[]; nextCursor: string | null };
    expect(body.events[0]).toMatchObject({ type: 'ACCOUNT_DISABLED', subjectEmail: 'bob@example.org', actor: 'Ada' });
    expect(body.events.some((event) => event.type === 'LOGIN_SUCCEEDED')).toBe(true);
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    const filtered = (await t.get(`/api/admin/security-events?userId=${bobId}`, t.admin)).json() as { events: { subjectEmail: string }[] };
    expect(new Set(filtered.events.map((event) => event.subjectEmail))).toEqual(new Set(['bob@example.org']));
    expect((await t.get('/api/admin/security-events', bob)).statusCode).toBe(401); // Bob is disabled now
    const carol = await t.invite('carol@example.org', 'Carol');
    expect((await t.get('/api/admin/security-events', carol)).statusCode).toBe(403);
    expect((await t.get('/api/admin/security-events')).statusCode).toBe(401);
    expect((await t.get('/api/admin/security-events?before=nope', t.admin)).statusCode).toBe(400);
    expect((await t.get('/api/admin/security-events?other=1', t.admin)).statusCode).toBe(400);
  });

  it('lets server admins hide the footer for everyone; audited; others refused', async () => {
    expect((await t.get('/api/about')).json()).toMatchObject({ footerHidden: false });
    expect((await t.post('/api/admin/settings', { footerHidden: true }, bob)).statusCode).toBe(403);
    expect((await t.post('/api/admin/settings', { footerHidden: true })).statusCode).toBe(401);
    expect((await t.post('/api/admin/settings', { footerHidden: true }, t.admin, null)).statusCode).toBe(403);
    for (const body of [{}, { footerHidden: 'yes' }, { footerHidden: true, other: 1 }]) {
      expect((await t.post('/api/admin/settings', body, t.admin)).statusCode).toBe(400);
    }
    expect((await t.get('/api/about')).json().footerHidden).toBe(false);

    const changed = await t.post('/api/admin/settings', { footerHidden: true }, t.admin);
    expect(changed.json()).toEqual({ settings: { footerHidden: true, recentProceduresLimit: 5 } });
    // Public, also before sign-in; the source link stays available.
    expect((await t.get('/api/about')).json()).toEqual({
      license: 'AGPL-3.0-only',
      sourceCodeUrl: expect.stringMatching(/^https:/),
      footerHidden: true,
    });
    const log = (await t.get('/api/admin/security-events', t.admin)).json() as { events: { type: string; metadata: object }[] };
    expect(log.events[0]).toMatchObject({ type: 'INSTANCE_SETTINGS_CHANGED', metadata: { footerHidden: true } });
    await t.post('/api/admin/settings', { footerHidden: false }, t.admin);
    expect((await t.get('/api/about')).json().footerHidden).toBe(false);
  });

  it('lets server admins set the Recent limit (0–20), server-side validated (13.13)', async () => {
    const bob = await t.invite('bob@example.org', 'Bob');
    expect((await t.get('/api/admin/settings', bob)).statusCode).toBe(403);
    expect((await t.post('/api/admin/settings', { recentProceduresLimit: 3 }, bob)).statusCode).toBe(403);
    for (const value of [-1, 21, 2.5, '5', null]) {
      expect((await t.post('/api/admin/settings', { recentProceduresLimit: value }, t.admin)).statusCode).toBe(400);
    }
    expect((await t.post('/api/admin/settings', { recentProceduresLimit: 0 }, t.admin)).json()).toEqual({ settings: { footerHidden: false, recentProceduresLimit: 0 } });
    expect((await t.get('/api/admin/settings', t.admin)).json()).toEqual({ settings: { footerHidden: false, recentProceduresLimit: 0 } });
    const log = (await t.get('/api/admin/security-events', t.admin)).json() as { events: { type: string; metadata: object }[] };
    expect(log.events[0]).toMatchObject({ type: 'INSTANCE_SETTINGS_CHANGED', metadata: { recentProceduresLimit: 0 } });
  });

  it('re-checks the server-admin flag when saving settings', async () => {
    t.database.sqlite.prepare("UPDATE users SET server_admin = 0 WHERE email = 'admin@example.org'").run();
    expect((await t.post('/api/admin/settings', { footerHidden: true }, t.admin)).statusCode).toBe(403);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM instance_settings').get()).toEqual({ n: 0 });
  });
});

