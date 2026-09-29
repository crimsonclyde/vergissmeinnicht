import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const STEP = { title: 'Milk', required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Buy groceries', icon: 'food', sections: [{ title: 'Shop', steps: [STEP] }] };
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('scheduled Procedures HTTP API (13.4)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let user: string;
  let guest: string;
  let procedureId: string;
  const schedules = () => `/api/workspaces/${home}/schedules`;
  const body = (overrides: object = {}) => ({
    procedureId,
    date: inDays(10),
    timeZone: 'Europe/Berlin',
    reminders: [
      { unit: 'DAYS', amount: 7 },
      { unit: 'DAYS', amount: 0 },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    t = await startTestApp();
    user = await t.invite('user@example.org', 'Uma');
    guest = await t.invite('guest@example.org', 'Gus');
    home = await t.createWorkspace('Home');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    procedureId = (await t.post(`/api/workspaces/${home}/procedures`, PROCEDURE, t.admin)).json().procedure.id;
  });
  afterEach(async () => t.close());

  it('schedules, lists, moves, starts once — and shows display names only', async () => {
    const created = await t.post(schedules(), body(), user);
    expect(created.statusCode).toBe(201);
    const item = created.json().schedule;
    expect(item).toMatchObject({ state: 'SCHEDULED', createdBy: 'Uma', reminderTime: '09:00', procedure: { title: 'Buy groceries', deleted: false }, runId: null });
    expect(created.body).not.toMatch(/userId|@example/);
    expect((await t.get(schedules(), guest)).json().schedules.map((s: { id: string }) => s.id)).toEqual([item.id]);
    // No Run exists until someone presses Start.
    expect((await t.get(`/api/workspaces/${home}/runs`, guest)).json().runs).toEqual([]);

    const moved = await t.post(`${schedules()}/${item.id}/update`, { ...body({ date: inDays(12), time: '18:30' }), procedureId: undefined, expectedRevision: 1 }, user);
    expect(moved.json().schedule).toMatchObject({ date: inDays(12), time: '18:30', revision: 2 });
    expect((await t.post(`${schedules()}/${item.id}/update`, { ...body(), procedureId: undefined, expectedRevision: 1 }, user)).json()).toEqual({ error: 'schedule_conflict' });

    const started = await t.post(`${schedules()}/${item.id}/start`, undefined, user);
    expect(started.statusCode).toBe(201);
    expect(started.json().run).toMatchObject({ state: 'ACTIVE', title: 'Buy groceries', startedBy: 'Uma' });
    expect((await t.get(`${schedules()}/${item.id}`, guest)).json().schedule).toMatchObject({ state: 'STARTED', runId: started.json().run.id, closed: { by: 'Uma' } });
    expect((await t.post(`${schedules()}/${item.id}/start`, undefined, user)).json()).toEqual({ error: 'schedule_closed' });
    expect((await t.get(schedules(), guest)).json().schedules).toEqual([]);
  });

  it('keeps GUESTs read-only and validates strictly', async () => {
    expect((await t.post(schedules(), body(), guest)).statusCode).toBe(403);
    const item = (await t.post(schedules(), body(), user)).json().schedule;
    expect((await t.post(`${schedules()}/${item.id}/cancel`, { expectedRevision: 1 }, guest)).statusCode).toBe(403);
    expect((await t.post(`${schedules()}/${item.id}/start`, undefined, guest)).statusCode).toBe(403);
    for (const invalid of [
      body({ date: inDays(-2) }),
      body({ timeZone: '+02:00' }),
      body({ reminders: [{ unit: 'DAYS', amount: 31 }] }),
      body({ reminders: [{ unit: 'MINUTES', amount: 5 }] }),
      body({ time: '7pm' }),
      body({ createdBy: 'someone else' }),
      body({ runId: item.id }),
    ]) {
      const response = await t.post(schedules(), invalid, user);
      expect({ invalid, status: response.statusCode }).toEqual({ invalid, status: 400 });
    }
    expect((await t.post(schedules(), body({ procedureId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' }), user)).statusCode).toBe(404);
    const cancelled = await t.post(`${schedules()}/${item.id}/cancel`, { expectedRevision: 1 }, user);
    expect(cancelled.json().schedule).toMatchObject({ state: 'CANCELLED', closed: { by: 'Uma' } });
  });

  it('refuses to start an item whose Procedure was deleted', async () => {
    const item = (await t.post(schedules(), body(), user)).json().schedule;
    await t.post(`/api/workspaces/${home}/procedures/${procedureId}/delete`, {}, t.admin);
    expect((await t.get(`${schedules()}/${item.id}`, user)).json().schedule.procedure).toMatchObject({ deleted: true });
    expect((await t.post(`${schedules()}/${item.id}/start`, undefined, user)).json()).toEqual({ error: 'procedure_unavailable' });
    expect((await t.get(`/api/workspaces/${home}/runs`, user)).json().runs).toEqual([]);
  });
});
