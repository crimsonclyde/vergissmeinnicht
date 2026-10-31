import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

let app: Awaited<ReturnType<typeof startTestApp>>;
let bob: string;
beforeEach(async () => { app = await startTestApp(); bob = await app.invite('guide@example.org', 'Guide reviewer'); });
afterEach(() => app.close());
const url = '/api/account/preferences';
const guide = { layout: 'classic', cardStyle: 'starfield', cardOpacity: 28, images: false };

it('saves only the authenticated account, preserves old partial updates, and leaves Workspace gates intact', async () => {
  expect((await app.post(url, { guide, theme: 'space-guide' }, bob)).json().preferences).toMatchObject({ guide, theme: 'space-guide' });
  await app.post(url, { criticalConfirm: 'tap-confirm' }, bob);
  expect((await app.get(url, bob)).json().preferences.guide).toEqual(guide);
  expect((await app.get(url, app.admin)).json().preferences.guide).toEqual(DEFAULT_GUIDE_PREFERENCES);
  const workspace = await app.createWorkspace('No permissions from appearance');
  await app.addMember(workspace, 'guide@example.org', 'GUEST');
  expect((await app.get(`/api/workspaces/${workspace}/equipment`, bob)).statusCode).toBe(404);
  expect((await app.post(`/api/workspaces/${workspace}/lists`, { title: 'No' }, bob)).statusCode).toBe(403);
  expect((await app.post(url, { guide }, bob, null)).statusCode).toBe(403);
  expect((await app.post(url, { guide })).statusCode).toBe(401);
  expect((await app.post(url, { guide, userId: 'other' }, bob)).statusCode).toBe(400);
  expect((await app.get(`${url}?userId=other`, bob)).statusCode).toBe(400);
});

it('rejects hostile values at API and SQL boundaries without changing the saved setting', async () => {
  await app.post(url, { guide }, bob);
  const invalid = [null, [], {}, { ...guide, layout: 'remote' }, { ...guide, cardStyle: 'url(https://bad.test)' }, { ...guide, images: 1 }, { ...guide, cardOpacity: -1 }, { ...guide, cardOpacity: 101 }, { ...guide, cardOpacity: 50.5 }, { ...guide, cardOpacity: '0; color:red' }, { ...guide, extra: true }];
  for (const value of invalid) {
    expect((await app.post(url, { guide: value }, bob)).statusCode).toBe(400);
    expect(() => app.database.sqlite.prepare('UPDATE user_preferences SET guide=?').run(JSON.stringify(value))).toThrow();
  }
  expect(() => app.database.sqlite.prepare('UPDATE user_preferences SET guide=?').run('{"layout":"guide","layout":"classic","cardStyle":"glass","cardOpacity":50,"images":true}')).toThrow();
  expect((await app.get(url, bob)).json().preferences.guide).toEqual(guide);
  const id = (await app.get('/api/auth/session', bob)).json().user.id as string;
  app.database.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(id);
  expect((await app.post(url, { guide }, bob)).statusCode).toBe(401);
});
