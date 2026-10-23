import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJournalContent } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

const content = { kind: 'note', version: 1, title: 'Autumn notes', date: '2026-10-23', body: '<script>alert(1)</script>\nThe old oak.' };
const body = (revision = 0, archived = false) => ({ content, expectedRevision: revision, archived });
describe('Journal and Moon module boundaries', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>; let ws: string; let other: string; let user: string; let guest: string;
  const shared = () => `/api/workspaces/${ws}/journal`;
  beforeEach(async () => { t = await startTestApp({ captureLogs: true }); ws = await t.createWorkspace('Home'); other = await t.createWorkspace('Van'); user = await t.invite('member@example.org', 'Member'); guest = await t.invite('guest@example.org', 'Guest'); await t.addMember(ws, 'member@example.org', 'USER'); await t.addMember(ws, 'guest@example.org', 'GUEST'); });
  afterEach(() => t.close());
  const enable = (tool: string) => t.post(`/api/workspaces/${ws}/tools`, { tool, enabled: true }, t.admin);
  it('keeps every shared route unknown while disabled and gates admin switches', async () => {
    for (const cookie of [t.admin, user, guest]) {
      expect((await t.get(shared(), cookie)).statusCode).toBe(404);
      expect((await t.post(shared(), body(), cookie)).statusCode).toBe(404);
      expect((await t.get(`/api/workspaces/${ws}/moon`, cookie)).statusCode).toBe(404);
    }
    expect((await t.post(`/api/workspaces/${ws}/tools`, { tool: 'MOON', enabled: true }, user)).statusCode).toBe(403);
    expect((await t.get('/api/account/journal')).statusCode).toBe(401);
    expect((await t.post('/api/account/journal', body(), user, null)).statusCode).toBe(403);
  });
  it('shares entries with members, refuses guest writes/foreign ids, preserves data across disable and archive', async () => {
    await enable('JOURNAL');
    const response = await t.post(shared(), body(), user); expect(response.statusCode).toBe(201);
    const entry = response.json().entry;
    expect((await t.get(`${shared()}/${entry.id}`, guest)).json().entry.body).toBe(content.body);
    expect(() => t.database.sqlite.prepare('UPDATE journal_entries SET workspace_id = ? WHERE id = ?').run(other, entry.id)).toThrow();
    expect(() => t.database.sqlite.prepare('UPDATE journal_entries SET date = ? WHERE id = ?').run('2026-02-30', entry.id)).toThrow();
    expect((await t.post(`${shared()}/${entry.id}`, body(1), guest)).statusCode).toBe(403);
    await t.addMember(other, 'member@example.org', 'USER');
    await t.post(`/api/workspaces/${other}/tools`, { tool: 'JOURNAL', enabled: true }, t.admin);
    expect((await t.get(`/api/workspaces/${other}/journal/${entry.id}`, user)).statusCode).toBe(404);
    expect((await t.post(`/api/workspaces/${other}/journal/${entry.id}`, body(1), user)).statusCode).toBe(404);
    expect((await t.get('/api/account/journal/' + entry.id, user)).statusCode).toBe(404);
    expect((await t.post(`${shared()}/${entry.id}`, body(1, true), user)).statusCode).toBe(200);
    expect((await t.post(`${shared()}/${entry.id}`, body(1), user)).statusCode).toBe(409);
    expect((await t.get(shared(), user)).json().entries).toHaveLength(0);
    expect((await t.get(shared() + '?archived=true&q=oak', user)).json().entries).toHaveLength(1);
    await t.post(`/api/workspaces/${ws}/tools`, { tool: 'JOURNAL', enabled: false }, t.admin);
    for (const cookie of [t.admin, user, guest]) for (const method of ['get', 'post'] as const) {
      const result = method === 'get' ? await t.get(`${shared()}/${entry.id}`, cookie) : await t.post(`${shared()}/${entry.id}`, body(2), cookie);
      expect(result.statusCode).toBe(404);
    }
    await enable('JOURNAL');
    expect((await t.post(`${shared()}/${entry.id}`, body(2), user)).statusCode).toBe(200);
  });
  it('keeps account-private entries author-only, even against Workspace/server admins and forged scope fields', async () => {
    const entry = (await t.post('/api/account/journal', body(), user)).json().entry;
    expect((await t.get('/api/account/journal', t.admin)).json().entries).toHaveLength(0);
    for (const cookie of [t.admin, guest]) {
      expect((await t.get(`/api/account/journal/${entry.id}`, cookie)).statusCode).toBe(404);
      expect((await t.post(`/api/account/journal/${entry.id}`, body(1), cookie)).statusCode).toBe(404);
    }
    expect((await t.get('/api/account/journal?ownerId=someone', user)).statusCode).toBe(400);
    expect((await t.post('/api/account/journal', { ...body(), workspaceId: ws }, user)).statusCode).toBe(400);
    await enable('JOURNAL');
    expect((await t.get(`${shared()}/${entry.id}`, t.admin)).statusCode).toBe(404);
    expect((await t.post(`${shared()}/${entry.id}`, body(1), user)).statusCode).toBe(404);
    expect((await t.get('/api/account/journal', user)).json().entries[0].id).toBe(entry.id);
    const events = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'JOURNAL_ENTRY_CHANGED'").all();
    expect(JSON.stringify(events)).not.toContain(content.title); expect(JSON.stringify(events)).not.toContain(entry.id);
    expect(t.logs).not.toContain(content.body); expect(t.logs).not.toContain(content.title);
    expect(() => t.database.sqlite.prepare('UPDATE private_journal_entries SET owner_id = (SELECT id FROM users WHERE email = ?) WHERE id = ?').run('guest@example.org', entry.id)).toThrow();
  });
  it('validates bounded versioned content, dates and scope and rolls writes back when audit fails', async () => {
    for (const change of [{ date: '2026-02-30' }, { kind: 'unknown' }, { version: 2 }, { body: 'x'.repeat(50_001) }, { body: '\u0000' }, { title: 'x\u202e' }]) expect((await t.post('/api/account/journal', { ...body(), content: { ...content, ...change } }, user)).statusCode).toBe(400);
    t.database.sqlite.exec("CREATE TRIGGER no_journal_audit BEFORE INSERT ON security_events WHEN NEW.type = 'JOURNAL_ENTRY_CHANGED' BEGIN SELECT RAISE(ABORT, 'fail'); END");
    expect((await t.post('/api/account/journal', body(), user)).statusCode).toBe(500);
    expect((await t.get('/api/account/journal', user)).json().entries).toHaveLength(0);
  });
  it('rechecks active account, role, tool and private ownership inside the write transaction', async () => {
    await enable('JOURNAL');
    const id = (t.database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get('member@example.org') as { id: string }).id;
    const actor = await t.services.journal.users.findById(id as Parameters<typeof t.services.journal.users.findById>[0]);
    if (actor === undefined) throw new Error('Missing fixture actor');
    const repo = t.services.journal.journal; const note = parseJournalContent(content);
    t.database.sqlite.prepare("UPDATE memberships SET role = 'GUEST' WHERE workspace_id = ? AND user_id = ?").run(ws, id);
    expect(await repo.save({ workspaceId: ws }, actor, note, undefined, 0, false, new Date())).toBe('forbidden');
    t.database.sqlite.prepare("UPDATE memberships SET role = 'USER' WHERE workspace_id = ? AND user_id = ?").run(ws, id);
    await t.post(`/api/workspaces/${ws}/tools`, { tool: 'JOURNAL', enabled: false }, t.admin);
    expect(await repo.save({ workspaceId: ws }, actor, note, undefined, 0, false, new Date())).toBe('forbidden');
    expect(await repo.save({ ownerId: 'someone-else' }, actor, note, undefined, 0, false, new Date())).toBe('forbidden');
    t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(id);
    expect(await repo.save({ ownerId: id }, actor, note, undefined, 0, false, new Date())).toBe('forbidden');
  });
  it('enforces the per-account entry limit, including archived entries', async () => {
    const entry = (await t.post('/api/account/journal', body(), user)).json().entry;
    const columns = 'id, kind, version, title, date, body, revision, archived, created_by_user_id, created_by, updated_by_user_id, updated_by, created_at, updated_at, owner_id';
    const statement = t.database.sqlite.prepare('INSERT INTO private_journal_entries (' + columns + ') SELECT ?, kind, version, title, date, body, revision, 1, created_by_user_id, created_by, updated_by_user_id, updated_by, created_at, updated_at, owner_id FROM private_journal_entries WHERE id = ?');
    t.database.sqlite.transaction(() => { for (let i = 1; i < 1000; i++) statement.run(`fixture-${i}`, entry.id); })();
    expect((await t.post('/api/account/journal', body(), user)).statusCode).toBe(400);
    expect((await t.get('/api/account/journal?archived=true', user)).json()).toMatchObject({ more: true });
  });
  it('uses only the authorized shared location for Moon, independently of Weather settings', async () => {
    await enable('MOON');
    expect((await t.get(`/api/workspaces/${ws}/moon`, guest)).json()).toEqual({ location: null });
    const location = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: null };
    await t.post(`/api/workspaces/${ws}/location`, { location, expectedLocation: null }, t.admin);
    expect((await t.get(`/api/workspaces/${ws}/moon`, guest)).json()).toEqual({ location });
    expect((await t.get(`/api/workspaces/${other}/moon`, guest)).statusCode).toBe(404);
    expect((await t.get(`/api/workspaces/${ws}/moon`)).statusCode).toBe(401);
  });
});
