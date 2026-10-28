import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBringContent, type WorkspaceId } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';
const content = { title: 'Bring drill', from: 'Munich', to: 'Triora', dueDate: null, assigneeId: null, notes: 'PRIVATE_NOTE<script>unsafe</script>' };
describe('Bring boundary and truthful transitions', () => {
 let t: Awaited<ReturnType<typeof startTestApp>>; let ws: string; let other: string; let user: string; let guest: string;
 const path = () => `/api/workspaces/${ws}/bring`;
 beforeEach(async () => { t = await startTestApp({ captureLogs: true }); ws = await t.createWorkspace('Home'); other = await t.createWorkspace('Van'); user = await t.invite('member@example.org', 'Member'); guest = await t.invite('guest@example.org', 'Guest'); await t.addMember(ws, 'member@example.org', 'USER'); await t.addMember(ws, 'guest@example.org', 'GUEST'); });
 afterEach(() => t.close());
 const enable = (workspace = ws, enabled = true) => t.post(`/api/workspaces/${workspace}/tools`, { tool: 'BRING', enabled }, t.admin);
 const create = () => t.post(path(), { content, expectedRevision: 0 }, user);
 it('requires session and Origin and keeps all disabled routes unknown for every role', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  for (const cookie of [t.admin, user, guest]) {
   expect((await t.get(path(), cookie)).statusCode).toBe(404);
   expect((await t.get(`${path()}/${id}`, cookie)).statusCode).toBe(404);
   expect((await t.post(path(), { content, expectedRevision: 0 }, cookie)).statusCode).toBe(404);
   for (const action of ['update', 'delete', 'restore', 'status']) expect((await t.post(`${path()}/${id}/${action}`, action === 'update' ? { content, expectedRevision: 1 } : action === 'status' ? { status: 'COMPLETED', expectedRevision: 1 } : { expectedRevision: 1 }, cookie)).statusCode).toBe(404);
  }
  expect((await enable()).statusCode).toBe(200);
  expect((await t.get(path())).statusCode).toBe(401);
  expect((await t.post(path(), { content, expectedRevision: 0 }, user, null)).statusCode).toBe(403);
  expect((await t.post(`/api/workspaces/${ws}/tools`, { tool: 'BRING', enabled: false }, user)).statusCode).toBe(403);
 });
 it('guests read but never write, assignment grants nothing, foreign ids are unknown and disable retains data', async () => {
  await enable(); await enable(other);
  const guestId = (t.database.sqlite.prepare('SELECT id FROM users WHERE email=?').get('guest@example.org') as { id: string }).id;
  const result = await t.post(path(), { content: { ...content, assigneeId: guestId }, expectedRevision: 0 }, user);
  expect(result.statusCode).toBe(201); const item = result.json().item;
  expect((await t.get(`${path()}/${item.id}`, guest)).json().item.notes).toBe(content.notes);
  for (const action of ['update', 'status', 'delete', 'restore']) expect((await t.post(`${path()}/${item.id}/${action}`, action === 'update' ? { content, expectedRevision: 1 } : action === 'status' ? { status: 'COMPLETED', expectedRevision: 1 } : { expectedRevision: 1 }, guest)).statusCode).toBe(403);
  expect((await create()).statusCode).toBe(201);
  expect((await t.post(path(), { content, expectedRevision: 0 }, guest)).statusCode).toBe(403);
  expect((await t.get(`/api/workspaces/${other}/bring/${item.id}`, t.admin)).statusCode).toBe(404);
  expect((await t.post(`/api/workspaces/${other}/bring/${item.id}/status`, { status: 'COMPLETED', expectedRevision: 1 }, t.admin)).statusCode).toBe(404);
  expect((await t.get(`/api/workspaces/${other}/bring`, user)).statusCode).toBe(404);
  await enable(ws, false); expect((await t.get(`${path()}/${item.id}`, t.admin)).statusCode).toBe(404); await enable();
  expect((await t.get(`${path()}/${item.id}`, user)).json().item.title).toBe(content.title);
  await t.post(`/api/workspaces/${ws}/members/${guestId}/remove`, {}, t.admin);
  const unassigned = (await t.get(`${path()}/${item.id}`, user)).json().item; expect(unassigned.assigneeId).toBeNull(); expect(unassigned.revision).toBe(2);
  expect((await t.post(path(), { content: { ...content, assigneeId: guestId }, expectedRevision: 0 }, user)).statusCode).toBe(400);
  expect(() => t.database.sqlite.prepare('UPDATE bring_items SET assignee_user_id=? WHERE id=?').run(guestId, item.id)).toThrow();
 });
 it('uses revisions, stamps actor and time, clears completion on cancellation and reopens without changing another item', async () => {
  await enable(); const item = (await create()).json().item; const second = (await create()).json().item;
  const done = (await t.post(`${path()}/${item.id}/status`, { status: 'COMPLETED', expectedRevision: 1 }, user)).json().item;
  expect(done).toMatchObject({ status: 'COMPLETED', revision: 2, completedBy: 'Member', cancelledAt: null }); expect(done.completedAt).toBeTruthy();
  expect((await t.post(`${path()}/${item.id}/status`, { status: 'CANCELLED', expectedRevision: 1 }, user)).statusCode).toBe(409);
  expect((await t.post(`${path()}/${item.id}/update`, { content, expectedRevision: 2 }, user)).statusCode).toBe(409);
  const cancelled = (await t.post(`${path()}/${item.id}/status`, { status: 'CANCELLED', expectedRevision: 2 }, user)).json().item;
  expect(cancelled).toMatchObject({ status: 'CANCELLED', revision: 3, completedAt: null, completedBy: null, cancelledBy: 'Member' });
  expect((await t.post(`${path()}/${item.id}/status`, { status: 'OPEN', expectedRevision: 3 }, user)).json().item).toMatchObject({ status: 'OPEN', completedAt: null, cancelledAt: null });
  expect((await t.get(`${path()}/${second.id}`, user)).json().item.revision).toBe(1);
  const deleted = (await t.post(`${path()}/${item.id}/delete`, { expectedRevision: 4 }, user)).json().item;
  expect((await t.get(`${path()}/${item.id}`, user)).statusCode).toBe(404);
  expect((await t.post(`${path()}/${item.id}/restore`, { expectedRevision: 4 }, user)).statusCode).toBe(409);
  expect((await t.post(`${path()}/${item.id}/restore`, { expectedRevision: deleted.revision }, user)).json().item.deleted).toBe(false);
  const events = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type='BRING_CHANGED'").all();
  expect(JSON.stringify(events)).toContain(content.title); expect(JSON.stringify(events)).not.toContain(content.notes); expect(t.logs).not.toContain(content.notes);
  expect(() => t.database.sqlite.prepare("UPDATE bring_items SET status='COMPLETED' WHERE id=?").run(second.id)).toThrow();
  for (const date of ['2026-13-99', '2026-02-30', 'not-a-date']) expect(() => t.database.sqlite.prepare('UPDATE bring_items SET due_date=? WHERE id=?').run(date, second.id)).toThrow();
  expect(() => t.database.sqlite.prepare('UPDATE bring_items SET workspace_id=? WHERE id=?').run(other, second.id)).toThrow();
 });
 it('validates hostile input and rolls back when audit insertion fails', async () => {
  await enable();
  for (const change of [{ title: '' }, { title: 'x'.repeat(121) }, { from: 'x'.repeat(81) }, { notes: '\u0000' }, { title: 'x\u202e' }, { dueDate: '2026-02-30' }, { assigneeId: 'unknown' }, { scope: other }]) expect((await t.post(path(), { content: { ...content, ...change }, expectedRevision: 0 }, user)).statusCode).toBe(400);
  expect((await t.get(path() + '?ownerId=other', user)).statusCode).toBe(400);
  expect((await t.post(path() + '?x=1', { content, expectedRevision: 0 }, user)).statusCode).toBe(400);
  t.database.sqlite.exec("CREATE TRIGGER refuse_bring_audit BEFORE INSERT ON security_events WHEN NEW.type='BRING_CHANGED' BEGIN SELECT RAISE(ABORT,'refuse'); END");
  expect((await create()).statusCode).toBe(500); expect((await t.get(path(), user)).json().items).toHaveLength(0);
 });
 it('filters relevance before totals and pagination; rejects forged dates; keeps history out of Today', async () => {
  await enable(); const uid = (t.database.sqlite.prepare('SELECT id FROM users WHERE email=?').get('member@example.org') as { id: string }).id;
  const today = new Date().toISOString().slice(0, 10); const end = new Date(today); end.setUTCDate(end.getUTCDate() + 7); const later = new Date(end); later.setUTCDate(later.getUTCDate() + 1);
  for (const change of [{ dueDate: today }, { dueDate: end.toISOString().slice(0, 10) }, { dueDate: '2020-01-01' }, { assigneeId: uid }, { dueDate: later.toISOString().slice(0, 10) }, {}]) expect((await t.post(path(), { content: { ...content, ...change }, expectedRevision: 0 }, user)).statusCode).toBe(201);
  const query = `${path()}?today=${today}`;
  const relevant = (await t.get(query, user)).json(); expect(relevant.total).toBe(4); expect(relevant.items).toHaveLength(3);
  expect(JSON.stringify(relevant)).not.toContain(content.notes); expect(relevant.items[0]).not.toHaveProperty('notes');
  expect((await t.get(query + '&filter=MINE', user)).json().total).toBe(1); expect((await t.get(query + '&filter=SHARED', user)).json().total).toBe(3);
  const item = relevant.items[0]; await t.post(`${path()}/${item.id}/status`, { status: 'COMPLETED', expectedRevision: item.revision }, user);
  expect((await t.get(query, user)).json().total).toBe(3);
  expect((await t.get(path() + '?today=1999-01-01', user)).statusCode).toBe(400);
  expect((await t.get(path() + '?offset=1001', user)).statusCode).toBe(400);
 });
 it('uses the shared Gamification gate and consumes off-period completions without rewarding replay', async () => {
  await enable();
  const item = (await create()).json().item;
  const done = (await t.post(`${path()}/${item.id}/status`, { status: 'COMPLETED', expectedRevision: 1 }, user)).json().item;
  expect((await t.get('/api/account/progress', user)).json().points).toBe(0);
  await t.post(`/api/workspaces/${ws}/tools`, { tool: 'GAMIFICATION', enabled: true }, t.admin);
  const reopened = (await t.post(`${path()}/${item.id}/status`, { status: 'OPEN', expectedRevision: done.revision }, user)).json().item;
  await t.post(`${path()}/${item.id}/status`, { status: 'COMPLETED', expectedRevision: reopened.revision }, user);
  expect((await t.get('/api/account/progress', user)).json().points).toBe(0);
  const fresh = (await create()).json().item;
  await t.post(`${path()}/${fresh.id}/status`, { status: 'COMPLETED', expectedRevision: fresh.revision }, user);
  expect((await t.get('/api/account/progress', user)).json().points).toBe(15);
 });
 it('rechecks actor status, role and switch in the mutation transaction', async () => {
  await enable(); const uid = (t.database.sqlite.prepare('SELECT id FROM users WHERE email=?').get('member@example.org') as { id: string }).id;
  const actor = await t.services.bring.users.findById(uid as Parameters<typeof t.services.bring.users.findById>[0]); if (actor === undefined) throw new Error('fixture actor');
  const write = () => t.services.bring.bring.change(ws as WorkspaceId, actor, undefined, 0, { kind: 'save', content: parseBringContent(content) }, new Date());
  t.database.sqlite.prepare("UPDATE memberships SET role='GUEST' WHERE workspace_id=? AND user_id=?").run(ws, uid); expect(await write()).toBe('forbidden');
  t.database.sqlite.prepare("UPDATE memberships SET role='USER' WHERE workspace_id=? AND user_id=?").run(ws, uid); await enable(ws, false); expect(await write()).toBe('forbidden');
  await enable(); t.database.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(uid); expect(await write()).toBe('forbidden');
 });
});
