import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const UNKNOWN_ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const THEME = '/api/account/workspace-preferences/theme';
const DEFAULT = '/api/account/workspace-preferences/default';

describe('per-Workspace preferences API (section 28)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let home: string;
  let van: string;
  let foreign: string;
  const rows = () => t.database.sqlite.prepare('SELECT count(*) AS n FROM user_workspace_preferences').get();
  const mine = async (cookie: string) => (await t.get('/api/account/workspace-preferences', cookie)).json().workspacePreferences;

  beforeEach(async () => {
    t = await startTestApp();
    bob = await t.invite('bob@example.org', 'Bob');
    home = await t.createWorkspace('Home');
    van = await t.createWorkspace('Van');
    foreign = await t.createWorkspace('Not Bob’s');
    await t.addMember(home, 'bob@example.org', 'USER');
    await t.addMember(van, 'bob@example.org', 'GUEST');
  });
  afterEach(() => t.close());

  it('stores a theme per Workspace and a default Workspace, for this account only', async () => {
    expect(await mine(bob)).toEqual({ defaultWorkspaceId: null, themes: {} });
    expect((await t.post(THEME, { workspaceId: home, theme: 'tokyo-nights' }, bob)).json().workspacePreferences).toEqual({ defaultWorkspaceId: null, themes: { [home]: 'tokyo-nights' } });
    // A GUEST may still choose how a Workspace looks to them.
    await t.post(THEME, { workspaceId: van, theme: 'witch-forest' }, bob);
    expect((await t.post(DEFAULT, { workspaceId: van }, bob)).json().workspacePreferences).toEqual({ defaultWorkspaceId: van, themes: { [home]: 'tokyo-nights', [van]: 'witch-forest' } });
    // Only one default: choosing another moves it, and the theme stays.
    expect((await t.post(DEFAULT, { workspaceId: home }, bob)).json().workspacePreferences.defaultWorkspaceId).toBe(home);
    expect((await mine(bob)).themes[van]).toBe('witch-forest');
    // The default theme is untouched, and other people see nothing of it.
    expect((await t.get('/api/account/preferences', bob)).json().preferences.theme).toBe('system');
    expect(await mine(t.admin)).toEqual({ defaultWorkspaceId: null, themes: {} });
  });

  it('clears with null and keeps no empty rows', async () => {
    await t.post(THEME, { workspaceId: home, theme: 'dark' }, bob);
    await t.post(DEFAULT, { workspaceId: home }, bob);
    await t.post(THEME, { workspaceId: home, theme: null }, bob);
    expect(await mine(bob)).toEqual({ defaultWorkspaceId: home, themes: {} });
    await t.post(DEFAULT, { workspaceId: null }, bob);
    expect(await mine(bob)).toEqual({ defaultWorkspaceId: null, themes: {} });
    expect(rows()).toEqual({ n: 0 });
  });

  it('answers a Workspace the person does not belong to as unknown and writes nothing', async () => {
    for (const workspaceId of [foreign, UNKNOWN_ID]) {
      expect((await t.post(THEME, { workspaceId, theme: 'dark' }, bob)).statusCode).toBe(404);
      expect((await t.post(DEFAULT, { workspaceId }, bob)).statusCode).toBe(404);
    }
    expect(rows()).toEqual({ n: 0 });
  });

  it('forgets nothing but lists nothing of a Workspace the person has left', async () => {
    await t.post(THEME, { workspaceId: van, theme: 'memento-mori' }, bob);
    await t.post(DEFAULT, { workspaceId: van }, bob);
    const bobId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'bob@example.org'").get() as { id: string }).id;
    expect((await t.post(`/api/workspaces/${van}/members/${bobId}/remove`, undefined, t.admin)).statusCode).toBeLessThan(300);
    expect(await mine(bob)).toEqual({ defaultWorkspaceId: null, themes: {} });
    expect((await t.post(THEME, { workspaceId: van, theme: 'dark' }, bob)).statusCode).toBe(404);
  });

  it('refuses a disabled account inside the write transaction', async () => {
    const bobId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'bob@example.org'").get() as { id: string }).id;
    const repository = t.services.preferences.preferences;
    t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bobId);
    expect(await repository.setWorkspaceTheme({ userId: bobId as never, workspaceId: home as never, theme: 'dark', at: new Date() })).toBe(false);
    expect(await repository.setDefaultWorkspace({ userId: bobId as never, workspaceId: home as never, at: new Date() })).toBe(false);
    expect(rows()).toEqual({ n: 0 });
  });

  it('validates strictly, needs a session and Origin, and the database refuses bad rows', async () => {
    for (const body of [{}, { workspaceId: home }, { workspaceId: home, theme: 'neon' }, { workspaceId: 'home', theme: 'dark' }, { workspaceId: home, theme: 'dark', userId: 'x' }]) {
      expect((await t.post(THEME, body, bob)).statusCode).toBe(400);
    }
    for (const body of [{}, { workspaceId: 'van' }, { workspaceId: home, theme: 'dark' }]) {
      expect((await t.post(DEFAULT, body, bob)).statusCode).toBe(400);
    }
    expect((await t.get('/api/account/workspace-preferences')).statusCode).toBe(401);
    expect((await t.post(THEME, { workspaceId: home, theme: 'dark' })).statusCode).toBe(401);
    expect((await t.post(DEFAULT, { workspaceId: home }, bob, null)).statusCode).toBe(403);
    expect(rows()).toEqual({ n: 0 });

    await t.post(THEME, { workspaceId: home, theme: 'dark' }, bob);
    await t.post(THEME, { workspaceId: van, theme: 'dark' }, bob);
    const sql = t.database.sqlite;
    expect(() => sql.prepare("UPDATE user_workspace_preferences SET theme = 'neon'").run()).toThrow(/CHECK constraint failed/);
    expect(() => sql.prepare('UPDATE user_workspace_preferences SET theme = NULL').run()).toThrow(/CHECK constraint failed/);
    expect(() => sql.prepare('UPDATE user_workspace_preferences SET is_default = 1').run()).toThrow(/UNIQUE constraint failed/);
  });
});
