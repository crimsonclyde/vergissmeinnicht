import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const HOME = { name: 'Home in Triora', latitude: 43.993, longitude: 7.7637, timeZone: 'Europe/Rome', elevation: 780 };
const PERSONAL = { ...HOME, name: 'Personal', latitude: 52.52, longitude: 13.4, elevation: null };
const SETTINGS = { location: PERSONAL, provider: 'AUTO', model: 'best_match', fallback: false, unit: 'C', showTomorrow: true };

describe('shared Workspace locations and personal opt-in', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let workspace: string;
  let guest: string;
  let requests: URL[];
  let revokeDuringFetch: boolean;
  let disableDuringFetch: boolean;
  beforeEach(async () => {
    requests = [];
    revokeDuringFetch = false;
    disableDuringFetch = false;
    t = await startTestApp({ weatherFetch: (async (input: string | URL | Request) => {
      if (disableDuringFetch) t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE email = ?").run('guest@example.org');
      if (revokeDuringFetch) t.database.sqlite.prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').run(workspace, 'guest@example.org');
      requests.push(new URL(input instanceof Request ? input.url : String(input)));
      return new Response(readFileSync(new URL('../../../../packages/weather/src/fixtures/open-meteo-best-match.json', import.meta.url), 'utf8'), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch });
    workspace = await t.createWorkspace('Home');
    guest = await t.invite('guest@example.org', 'Guest');
    await t.addMember(workspace, 'guest@example.org', 'GUEST');
  });
  afterEach(() => t.close());
  const path = () => `/api/workspaces/${workspace}/location`;
  const save = (location: unknown, expectedLocation: unknown = null, cookie = t.admin) => t.post(path(), { location, expectedLocation }, cookie);

  it('starts unset, allows admin save/clear, rounds coordinates, shares with members and audits no location data', async () => {
    expect((await t.get(path(), guest)).json()).toEqual({ location: null });
    const answer = await save(HOME);
    expect(answer.statusCode).toBe(200);
    const location = answer.json().location;
    expect(location).toMatchObject({ name: HOME.name, latitude: 43.99, longitude: 7.76 });
    expect((await t.get(path(), guest)).json()).toEqual({ location });
    expect(requests).toEqual([]);
    const event = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'WORKSPACE_LOCATION_CHANGED'").get() as { metadata: string };
    expect(JSON.parse(event.metadata)).toEqual({ locationSet: true });
    expect((await save(null, location)).statusCode).toBe(200);
    expect((await t.get(path(), guest)).json().location).toBeNull();
  });

  it('rejects non-admin writes, unknown/nonmember Workspaces, missing sessions, CSRF and stale updates', async () => {
    for (const role of ['GUEST', 'USER', 'EDITOR']) {
      t.database.sqlite.prepare('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').run(role, workspace, 'guest@example.org');
      expect((await save(HOME, null, guest)).statusCode).toBe(403);
    }
    const other = await t.createWorkspace('Van');
    expect((await t.get(`/api/workspaces/${other}/location`, guest)).statusCode).toBe(404);
    expect((await t.post(`/api/workspaces/${other}/location`, { location: HOME, expectedLocation: null }, guest)).statusCode).toBe(404);
    expect((await t.get(path())).statusCode).toBe(401);
    expect((await t.post(path(), { location: HOME, expectedLocation: null }, t.admin, null)).statusCode).toBe(403);
    expect((await save(HOME)).statusCode).toBe(200);
    expect((await save(null)).statusCode).toBe(409);
    expect((await t.get(path(), t.admin)).json().location.name).toBe(HOME.name);
  });

  it('rejects malformed location input and database bypasses, and rolls back when auditing fails', async () => {
    for (const location of [{ ...HOME, latitude: 91 }, { ...HOME, longitude: Infinity }, { ...HOME, timeZone: 'Mars/Olympus' }, { ...HOME, secret: 'x' }, { ...HOME, name: 'Home\u202e' }]) {
      expect((await save(location)).statusCode).toBe(400);
    }
    for (const location of ['bad-json', '{}', JSON.stringify({ ...HOME, latitude: 91 })]) {
      expect(() => t.database.sqlite.prepare('UPDATE workspaces SET location = ? WHERE id = ?').run(location, workspace)).toThrow();
    }
    t.database.sqlite.exec("CREATE TRIGGER fail_location_audit BEFORE INSERT ON security_events WHEN NEW.type = 'WORKSPACE_LOCATION_CHANGED' BEGIN SELECT RAISE(ABORT, 'no audit'); END");
    expect((await save(HOME)).statusCode).toBe(500);
    expect((await t.get(path(), t.admin)).json().location).toBeNull();
  });

  it('requires each person to opt in and keeps personal fallback, credentials and other Workspaces independent', async () => {
    await save(HOME);
    await t.post('/api/account/weather', { settings: SETTINGS }, guest);
    const mine = `/api/account/weather?workspaceId=${workspace}`;
    expect((await t.get(mine, guest)).json().settings.location.name).toBe('Personal');
    await t.post('/api/account/weather', { settings: { ...SETTINGS, useWorkspaceLocation: true } }, guest);
    expect((await t.get(mine, guest)).json().settings.location.name).toBe(HOME.name);
    expect((await t.get('/api/account/weather', guest)).json().settings.location.name).toBe('Personal');
    expect((await t.get(mine, t.admin)).json().settings.location).toBeNull();
    const other = await t.createWorkspace('Van');
    await t.addMember(other, 'guest@example.org', 'GUEST');
    expect((await t.get(`/api/account/weather?workspaceId=${other}`, guest)).json().settings.location.name).toBe('Personal');
    const forecast = await t.get(`/api/account/weather/forecast?days=2&workspaceId=${workspace}`, guest);
    expect(forecast.statusCode).toBe(200);
    expect(forecast.json().location.name).toBe(HOME.name);
    expect(requests.at(-1)?.searchParams.get('latitude')).toBe('43.99');
    expect(requests.at(-1)?.searchParams.get('longitude')).toBe('7.76');
  });

  it.each(['revoked', 'disabled'] as const)('rechecks the current account/membership after provider work (%s)', async (reason) => {
    await save(HOME);
    await t.post('/api/account/weather', { settings: { ...SETTINGS, useWorkspaceLocation: true } }, guest);
    revokeDuringFetch = reason === 'revoked';
    disableDuringFetch = reason === 'disabled';
    expect((await t.get(`/api/account/weather/forecast?workspaceId=${workspace}`, guest)).statusCode).toBe(404);
  });

  it('refuses foreign/revoked Workspace weather before any outbound request, even without opt-in', async () => {
    await t.post('/api/account/weather', { settings: SETTINGS }, guest);
    t.database.sqlite.prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').run(workspace, 'guest@example.org');
    expect((await t.get(`/api/account/weather?workspaceId=${workspace}`, guest)).statusCode).toBe(404);
    expect((await t.get(`/api/account/weather/forecast?workspaceId=${workspace}`, guest)).statusCode).toBe(404);
    expect((await t.get('/api/account/weather?workspaceId=bogus', guest)).statusCode).toBe(400);
    expect(requests).toEqual([]);
  });
});
