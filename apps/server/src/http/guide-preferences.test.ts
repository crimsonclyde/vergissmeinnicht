import { afterEach, expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

const UNKNOWN_ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const GUIDE = '/api/account/workspace-preferences/guide';
const THEME = '/api/account/workspace-preferences/theme';
const WORKSPACE_PREFERENCES = '/api/account/workspace-preferences';
const classic = { layout: 'classic', cardStyle: 'starfield', cardOpacity: 28, images: false };

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const app of open.splice(0)) await app.close();
});

async function setup() {
  const app = await startTestApp();
  open.push(app);
  const bob = await app.invite('guide@example.org', 'Guide reviewer');
  const home = await app.createWorkspace('Home');
  const van = await app.createWorkspace('Van');
  const foreign = await app.createWorkspace('Not Guide’s');
  await app.addMember(home, 'guide@example.org', 'USER');
  await app.addMember(van, 'guide@example.org', 'GUEST');
  const rows = () => app.database.sqlite.prepare('SELECT count(*) AS n FROM user_workspace_preferences').get();
  const guidesOf = async (cookie: string) => (await app.get(WORKSPACE_PREFERENCES, cookie)).json().workspacePreferences.guides;
  return { app, bob, home, van, foreign, rows, guidesOf };
}

it('stores the Guide per Workspace and per account; a Workspace without a row has no entry and the default applies', async () => {
  const { app, bob, home, van, guidesOf } = await setup();
  await app.post(THEME, { workspaceId: home, theme: 'dark' }, bob);
  expect((await app.post(GUIDE, { workspaceId: home, guide: classic }, bob)).json().workspacePreferences).toEqual({ defaultWorkspaceId: null, themes: { [home]: 'dark' }, guides: { [home]: classic } });
  // A GUEST may choose how a Workspace looks to them; a partial change starts from the default.
  expect((await app.post(GUIDE, { workspaceId: van, guide: { images: false } }, bob)).statusCode).toBe(200);
  expect(await guidesOf(bob)).toEqual({ [home]: classic, [van]: { ...DEFAULT_GUIDE_PREFERENCES, images: false } });
  // Nobody else sees Bob's choices, including the administrator.
  expect(await guidesOf(app.admin)).toEqual({});
});

it('a partial change keeps every other key; the stored value is always the whole Guide', async () => {
  const { app, bob, home } = await setup();
  await app.post(GUIDE, { workspaceId: home, guide: classic }, bob);
  expect((await app.post(GUIDE, { workspaceId: home, guide: { cardOpacity: 60 } }, bob)).json().workspacePreferences.guides[home]).toEqual({ ...classic, cardOpacity: 60 });
  expect((await app.post(GUIDE, { workspaceId: home, guide: { layout: 'guide' } }, bob)).json().workspacePreferences.guides[home]).toEqual({ ...classic, cardOpacity: 60, layout: 'guide' });
  const stored = app.database.sqlite.prepare('SELECT guide FROM user_workspace_preferences WHERE user_id = (SELECT id FROM users WHERE email = ?) AND workspace_id = ?').get('guide@example.org', home) as { guide: string };
  expect(JSON.parse(stored.guide)).toEqual({ ...classic, cardOpacity: 60, layout: 'guide' });
});

it('null clears the Guide and keeps no empty row', async () => {
  const { app, bob, home, rows } = await setup();
  await app.post(GUIDE, { workspaceId: home, guide: classic }, bob);
  expect((await app.post(GUIDE, { workspaceId: home, guide: null }, bob)).json().workspacePreferences.guides).toEqual({});
  expect(rows()).toEqual({ n: 0 });
});

it('answers a Workspace the person does not belong to as unknown and writes nothing', async () => {
  const { app, bob, foreign, rows } = await setup();
  for (const workspaceId of [foreign, UNKNOWN_ID]) expect((await app.post(GUIDE, { workspaceId, guide: classic }, bob)).statusCode).toBe(404);
  expect(rows()).toEqual({ n: 0 });
});

it('validates strictly: malformed bodies are 400, unauthenticated or Origin-less requests are refused, and the database refuses bad Guide JSON', async () => {
  const { app, bob, home, guidesOf } = await setup();
  await app.post(GUIDE, { workspaceId: home, guide: classic }, bob);
  for (const body of [
    {},
    { workspaceId: home },
    { workspaceId: 'home', guide: classic },
    { workspaceId: home, guide: {} },
    { workspaceId: home, guide: { layout: 'remote' } },
    { workspaceId: home, guide: { cardStyle: 'url(https://bad.test)' } },
    { workspaceId: home, guide: { cardOpacity: 101 } },
    { workspaceId: home, guide: { cardOpacity: 50.5 } },
    { workspaceId: home, guide: { images: 1 } },
    { workspaceId: home, guide: { ...classic, extra: true } },
    { workspaceId: home, guide: [] },
    { workspaceId: home, guide: classic, userId: 'x' },
    { workspaceId: home, guide: null, theme: 'dark' },
  ]) {
    expect((await app.post(GUIDE, body, bob)).statusCode).toBe(400);
  }
  expect((await app.post(GUIDE, { workspaceId: home, guide: classic })).statusCode).toBe(401);
  expect((await app.post(GUIDE, { workspaceId: home, guide: classic }, bob, null)).statusCode).toBe(403);
  const update = app.database.sqlite.prepare('UPDATE user_workspace_preferences SET guide = ?');
  for (const value of ['{"layout":"remote","cardStyle":"glass","cardOpacity":50,"images":true}', '{"layout":"guide","cardStyle":"glass","cardOpacity":50,"images":true,"extra":true}', '{"layout":"guide","layout":"classic","cardStyle":"glass","cardOpacity":50,"images":true}']) {
    expect(() => update.run(value)).toThrow();
  }
  expect(await guidesOf(bob)).toEqual({ [home]: classic });
});
