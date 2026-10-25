import { afterAll, beforeAll, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

let t: Awaited<ReturnType<typeof startTestApp>>;
let home: string; let otherHome: string; let user: string; let guest: string; let editor: string; let outsider: string;
const total = async (cookie = user) => (await t.get('/api/account/progress', cookie)).json().points as number;
const plugin = (workspaceId: string, enabled: boolean, cookie = t.admin, origin?: null) => t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'GAMIFICATION', enabled }, cookie, origin);
beforeAll(async () => {
  t = await startTestApp(); home = await t.createWorkspace('Optional encouragement'); otherHome = await t.createWorkspace('Separate');
  user = await t.invite('gamification-user@example.org', 'User'); guest = await t.invite('gamification-guest@example.org', 'Guest'); editor = await t.invite('gamification-editor@example.org', 'Editor'); outsider = await t.invite('gamification-outsider@example.org', 'Outsider');
  for (const [email, role] of [['gamification-user@example.org', 'USER'], ['gamification-guest@example.org', 'GUEST'], ['gamification-editor@example.org', 'EDITOR']]) await t.addMember(home, email ?? '', role ?? '');
  await t.addMember(otherHome, 'gamification-user@example.org', 'USER');
  for (const ws of [home, otherHome]) for (const tool of ['EQUIPMENT', 'JOURNAL']) await t.post(`/api/workspaces/${ws}/tools`, { tool, enabled: true }, t.admin);
});
afterAll(async () => t.close());

it('starts off in new Workspaces and only a Workspace admin may switch it, with CSRF and revision protection', async () => {
  expect((await t.get(`/api/workspaces/${home}`, user)).json().tools).not.toContain('GAMIFICATION');
  for (const cookie of [user, guest, editor]) expect((await plugin(home, true, cookie)).statusCode).toBe(403);
  expect((await plugin(home, true, outsider)).statusCode).toBe(404);
  expect((await plugin(home, true, t.admin, null)).statusCode).toBe(403);
  const revision = (await t.get(`/api/workspaces/${home}`, user)).json().toolsRevision as number;
  expect((await t.post(`/api/workspaces/${home}/tools`, { tool: 'GAMIFICATION', enabled: true, expectedRevision: revision - 1 }, t.admin)).statusCode).toBe(409);
  expect(await total()).toBe(0);
});

it('awards nothing while off, keeps tool mutations usable, and never rewards off-period checks after re-enable', async () => {
  expect((await t.post(`/api/workspaces/${home}/equipment`, { name: 'Off-period appliance' }, user)).statusCode).toBe(201);
  const list = (await t.post(`/api/workspaces/${home}/lists`, { title: 'Groceries' }, user)).json().list;
  const item = (await t.post(`/api/workspaces/${home}/lists/${list.id}/items`, { title: 'Milk' }, user)).json().list.items[0];
  const path = `/api/workspaces/${home}/lists/${list.id}/items/${item.id}/check`;
  expect((await t.post(path, { checked: true }, user)).statusCode).toBe(200);
  expect(await total()).toBe(0);
  expect((await plugin(home, true)).statusCode).toBe(200);
  await t.post(path, { checked: false }, user); await t.post(path, { checked: true }, user);
  expect(await total()).toBe(0);
  expect((await t.post(`/api/workspaces/${home}/equipment`, { name: 'Enabled appliance' }, user)).statusCode).toBe(201);
  expect(await total()).toBe(10);
  await plugin(home, false);
  expect(await total()).toBe(10);
  expect((await t.get(`/api/workspaces/${home}/equipment`, user)).json().records).toHaveLength(2);
});

it('uses the mutation Workspace, never another Workspace switch or a client score', async () => {
  await plugin(home, true);
  const before = await total();
  await t.post(`/api/workspaces/${otherHome}/equipment`, { name: 'Still off' }, user);
  expect(await total()).toBe(before);
  await t.post(`/api/workspaces/${home}/equipment`, { name: 'On here' }, user);
  expect(await total()).toBe(before + 10);
  expect(await total(guest)).toBe(0);
  expect((await t.post('/api/account/progress', { points: 1000 }, user)).statusCode).toBe(404);
  expect((await t.post(`/api/workspaces/${home}/equipment`, { name: 'No access' }, outsider)).statusCode).toBe(404);
});

it('separates shared and private Journal switches and protects the account setting', async () => {
  const body = { content: { kind: 'note', version: 1, title: 'Note', date: '2026-10-25', body: 'Text' }, expectedRevision: 0, archived: false };
  await plugin(home, false);
  const before = await total();
  expect((await t.post('/api/account/preferences', { privateGamification: false }, user)).statusCode).toBe(200);
  await t.post('/api/account/preferences', { theme: 'dark' }, user);
  expect((await t.get('/api/account/preferences', user)).json().preferences.privateGamification).toBe(false);
  expect((await t.get('/api/account/preferences', outsider)).json().preferences.privateGamification).toBe(true);
  expect((await t.post('/api/account/journal', body, user)).statusCode).toBe(201);
  expect(await total()).toBe(before);
  await plugin(home, true);
  expect((await t.post(`/api/workspaces/${home}/journal`, body, user)).statusCode).toBe(201);
  expect(await total()).toBe(before + 5);
  await plugin(home, false);
  await t.post('/api/account/preferences', { privateGamification: true }, user);
  await t.post('/api/account/journal', body, user);
  expect(await total()).toBe(before + 10);
  expect((await t.get('/api/account/preferences', outsider)).json().preferences.privateGamification).toBe(true);
  for (const value of ['true', 1, null]) expect((await t.post('/api/account/preferences', { privateGamification: value }, user)).statusCode).toBe(400);
  expect((await t.post('/api/account/preferences', { privateGamification: false, userId: 'other' }, user)).statusCode).toBe(400);
  expect(() => t.database.sqlite.prepare('UPDATE user_preferences SET private_gamification=2').run()).toThrow();
});
