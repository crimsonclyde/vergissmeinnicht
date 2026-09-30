import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const STEP = { title: 'Milk', required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Buy groceries', icon: 'food', sections: [{ title: 'Shop', steps: [STEP] }] };
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('Schedules and Occurrences HTTP API (13.4, 14.1)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let user: string;
  let other: string;
  let guest: string;
  let procedureId: string;
  const schedules = () => `/api/workspaces/${home}/schedules`;
  const occurrences = () => `/api/workspaces/${home}/occurrences`;
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
  const firstOccurrence = async (scheduleId: string, cookie: string) => (await t.get(`${schedules()}/${scheduleId}`, cookie)).json().occurrences[0];

  beforeEach(async () => {
    t = await startTestApp();
    user = await t.invite('user@example.org', 'Uma');
    other = await t.invite('other@example.org', 'Olli');
    guest = await t.invite('guest@example.org', 'Gus');
    home = await t.createWorkspace('Home');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'other@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    procedureId = (await t.post(`/api/workspaces/${home}/procedures`, PROCEDURE, t.admin)).json().procedure.id;
  });
  afterEach(async () => t.close());

  it('keeps the 13.4 request shapes working: schedule, list, move, start once — display names only', async () => {
    const created = await t.post(schedules(), { ...body(), reminderTime: '09:00' }, user);
    expect(created.statusCode).toBe(201);
    const item = created.json().schedule;
    expect(item).toMatchObject({ kind: 'PROCEDURE', state: 'ACTIVE', createdBy: 'Uma', recurrence: { kind: 'ONCE' }, procedure: { title: 'Buy groceries', deleted: false }, assignee: null });
    expect(created.body).not.toMatch(/userId|@example/);
    expect((await t.get(schedules(), guest)).json().schedules.map((s: { id: string }) => s.id)).toEqual([item.id]);
    expect((await t.get(`/api/workspaces/${home}/runs`, guest)).json().runs).toEqual([]);

    const moved = await t.post(`${schedules()}/${item.id}/update`, { ...body({ date: inDays(12), time: '18:30' }), procedureId: undefined, expectedRevision: 1 }, user);
    expect(moved.json().schedule).toMatchObject({ date: inDays(12), time: '18:30', revision: 2 });
    expect((await t.post(`${schedules()}/${item.id}/update`, { ...body(), procedureId: undefined, expectedRevision: 1 }, user)).json()).toEqual({ error: 'schedule_conflict' });
    expect((await firstOccurrence(item.id, user)).dueDate).toBe(inDays(12));

    const started = await t.post(`${schedules()}/${item.id}/start`, undefined, user);
    expect(started.statusCode).toBe(201);
    expect((await t.post(`${schedules()}/${item.id}/start`, undefined, user)).json()).toEqual({ error: 'schedule_closed' });
    const occurrence = await firstOccurrence(item.id, user);
    expect(occurrence).toMatchObject({ state: 'IN_PROGRESS', run: { id: started.json().run.id, state: 'ACTIVE', startedBy: 'Uma' } });
  });

  it('creates a recurring Reminder, completes it (recording who) and reopens it', async () => {
    const created = await t.post(
      schedules(),
      { title: 'Pay annual tax', date: inDays(3), timeZone: 'Europe/Berlin', recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 }, reminders: [{ unit: 'MONTHS', amount: 1 }], assigneeUserId: null },
      user,
    );
    expect(created.statusCode).toBe(201);
    const schedule = created.json().schedule;
    expect(schedule).toMatchObject({ kind: 'REMINDER', title: 'Pay annual tax', recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 } });
    const occurrence = await firstOccurrence(schedule.id, user);
    const done = await t.post(`${occurrences()}/${occurrence.id}/complete`, {}, other);
    expect(done.json().occurrence).toMatchObject({ state: 'COMPLETED', closed: { by: 'Olli' }, responsible: null });
    expect((await t.post(`${occurrences()}/${occurrence.id}/complete`, {}, user)).json()).toEqual({ error: 'schedule_closed' });
    expect((await t.post(`${occurrences()}/${occurrence.id}/reopen`, {}, user)).json().occurrence).toMatchObject({ state: 'OPEN', closed: null });
    const home_ = (await t.get(`/api/workspaces/${home}/home`, guest)).json();
    expect([...home_.overdue, ...home_.today, ...home_.upcoming].map((item: { id: string }) => item.id)).toContain(occurrence.id);
  });

  it('assigns without granting anything and keeps GUESTs read-only', async () => {
    const guestId = (await t.get('/api/auth/session', guest)).json().user.id as string;
    const created = await t.post(schedules(), { title: 'Check smoke alarms', date: inDays(2), timeZone: 'UTC', reminders: [], assigneeUserId: guestId }, user);
    expect(created.json().schedule.assignee).toMatchObject({ id: guestId, name: 'Gus' });
    const occurrence = await firstOccurrence(created.json().schedule.id, guest);
    expect(occurrence.responsible).toMatchObject({ name: 'Gus' });
    for (const action of ['complete', 'skip', 'reopen', 'unlink-run']) {
      expect((await t.post(`${occurrences()}/${occurrence.id}/${action}`, {}, guest)).statusCode, action).toBe(403);
    }
    expect((await t.post(`${occurrences()}/${occurrence.id}/assign`, { assigneeUserId: null }, guest)).statusCode).toBe(403);
    expect((await t.post(schedules(), body(), guest)).statusCode).toBe(403);
    // A non-member cannot be assigned.
    const outsider = await t.invite('outsider@example.org', 'Otto');
    const outsiderId = (await t.get('/api/auth/session', outsider)).json().user.id as string;
    expect((await t.post(`${occurrences()}/${occurrence.id}/assign`, { assigneeUserId: outsiderId }, user)).json()).toEqual({ error: 'invalid_assignee' });
  });

  it('validates strictly', async () => {
    const bad = [
      { ...body(), extra: 1 },
      { ...body(), reminders: [{ unit: 'YEARS', amount: 1 }] },
      { ...body(), date: 12 },
      { ...body(), assigneeUserId: 'not-a-uuid' },
      { ...body(), recurrence: { kind: 'FIXED', unit: 'WEEK', weekdays: [1, 2, 3, 4, 5, 6, 7, 1] } },
    ];
    for (const payload of bad) expect((await t.post(schedules(), payload, user)).statusCode, JSON.stringify(payload)).toBe(400);
    expect((await t.post(schedules(), { ...body(), recurrence: { kind: 'FIXED', unit: 'HOUR' } }, user)).json()).toMatchObject({ error: 'invalid_recurrence' });
    expect((await t.post(schedules(), { title: '', date: inDays(1), timeZone: 'UTC', reminders: [] }, user)).json()).toMatchObject({ error: 'reminder_title_empty' });
    expect((await t.post(schedules(), { ...body(), date: inDays(-1) }, user)).json()).toMatchObject({ error: 'date_in_past' });
  });
});
