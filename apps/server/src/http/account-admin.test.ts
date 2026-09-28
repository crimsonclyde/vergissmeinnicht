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
});
