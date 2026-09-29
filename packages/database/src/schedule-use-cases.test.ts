import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  ProcedureNotFoundError,
  ScheduleClosedError,
  ScheduleConflictError,
  ScheduleNotFoundError,
  ScheduledProcedureUnavailableError,
  WorkspaceNotFoundError,
  addMember,
  cancelSchedule,
  changeMemberRole,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getSchedule,
  listOpenSchedules,
  rescheduleProcedure,
  scheduleProcedure,
  startScheduledProcedure,
  type ProcedureInput,
  type RunDeps,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ProcedureId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const PROCEDURE: ProcedureInput = {
  title: 'Buy groceries',
  description: '',
  icon: 'food',
  tags: [],
  sections: [{ title: 'Shop', description: '', steps: [{ ...STEP, title: 'Milk' }] }],
};
const BERLIN = 'Europe/Berlin';

describe('scheduled Procedures (13.4)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: ScheduleDeps & RunDeps;
  let now: Date;
  let admin: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let groceries: ProcedureId;
  let foreign: ProcedureId;

  const schedule = (actor: User = uma, overrides: Partial<Parameters<typeof scheduleProcedure>[1]> = {}) =>
    scheduleProcedure(deps, {
      actor,
      workspaceId: home.id,
      procedureId: groceries,
      date: '2026-10-15',
      timeZone: BERLIN,
      reminders: [
        { unit: 'DAYS', amount: 7 },
        { unit: 'DAYS', amount: 1 },
        { unit: 'DAYS', amount: 0 },
      ],
      ...overrides,
    });
  const reminders = (scheduleId: string) =>
    database.sqlite
      .prepare('SELECT reminder_key AS key, remind_at AS at, recipient_user_id AS recipient, cancelled_at AS cancelled, processed_at AS processed FROM scheduled_reminders WHERE schedule_id = ? ORDER BY remind_at, rowid')
      .all(scheduleId) as { key: string; at: number; recipient: string; cancelled: number | null; processed: number | null }[];
  const runCount = () => (database.sqlite.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n;
  const auditTypes = () =>
    (database.sqlite.prepare("SELECT type FROM audit_events WHERE subject_type = 'schedule' ORDER BY rowid").all() as { type: string }[]).map((row) => row.type);

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-29T10:00:00Z');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    deps = {
      workspaces,
      schedules: createScheduleRepository(database),
      notificationPreferences: createNotificationPreferencesRepository(database),
      runs: createRunRepository(database),
      clock,
    };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: uma.email, role: 'USER' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: gus.email, role: 'GUEST' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    const procedureDeps = { workspaces, procedures: createProcedureRepository(database), clock };
    groceries = (await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE })).procedure.id;
    foreign = (await createProcedure(procedureDeps, { actor: admin, workspaceId: office.id, content: PROCEDURE })).procedure.id;
  });
  afterEach(() => database.dispose());

  it('stores the intention with reminders for the person who scheduled it — and no Run', async () => {
    const item = await schedule();
    expect(item).toMatchObject({
      state: 'SCHEDULED',
      date: '2026-10-15',
      time: null,
      timeZone: BERLIN,
      reminderTime: '09:00',
      procedure: { title: 'Buy groceries', deleted: false },
      createdBy: { userId: uma.id, displayName: 'Uma' },
      runId: null,
      closed: null,
      revision: 1,
    });
    expect(reminders(item.id)).toEqual([
      { key: 'DAYS:7', at: Date.parse('2026-10-08T07:00:00Z'), recipient: uma.id, cancelled: null, processed: null },
      { key: 'DAYS:1', at: Date.parse('2026-10-14T07:00:00Z'), recipient: uma.id, cancelled: null, processed: null },
      { key: 'DAYS:0', at: Date.parse('2026-10-15T07:00:00Z'), recipient: uma.id, cancelled: null, processed: null },
    ]);
    expect(runCount()).toBe(0);
    expect(auditTypes()).toEqual(['SCHEDULE_CREATED']);
  });

  it('uses the scheduler’s default reminder time and an own time of day', async () => {
    await deps.notificationPreferences.save(uma.id, { reminderTime: '07:30' as never, emailReminders: true, telegramReminders: true }, now);
    const item = await schedule(uma, { time: '18:00', reminders: [{ unit: 'HOURS', amount: 2 }, { unit: 'DAYS', amount: 0 }] });
    expect(item.reminderTime).toBe('07:30');
    expect(reminders(item.id).map((r) => [r.key, new Date(r.at).toISOString()])).toEqual([
      ['DAYS:0', '2026-10-15T05:30:00.000Z'],
      ['HOURS:2', '2026-10-15T14:00:00.000Z'],
    ]);
  });

  it('never stores reminders that are already due, and sends one per instant', async () => {
    now = new Date('2026-10-12T12:00:00Z');
    const item = await schedule(uma, { time: '09:00', reminders: [{ unit: 'DAYS', amount: 7 }, { unit: 'DAYS', amount: 1 }, { unit: 'HOURS', amount: 24 }] });
    // 7 days before is past; "1 day before at 09:00" and "24 hours before 09:00" are the same instant.
    expect(reminders(item.id).map((r) => r.key)).toEqual(['DAYS:1']);
  });

  it('validates date, time, zone and reminders on the server', async () => {
    const code = async (overrides: Partial<Parameters<typeof scheduleProcedure>[1]>) =>
      schedule(uma, overrides).then(
        () => undefined,
        (error: unknown) => (error instanceof DomainValidationError ? error.code : String(error)),
      );
    expect(await code({ date: '2026-09-28' })).toBe('date_in_past');
    expect(await code({ date: '2026-02-30' })).toBe('invalid_date');
    expect(await code({ date: '2030-01-01' })).toBe('date_too_far');
    expect(await code({ time: '25:00' })).toBe('invalid_time');
    expect(await code({ reminderTime: '9am' })).toBe('invalid_time');
    expect(await code({ timeZone: 'Mars/Base' })).toBe('invalid_time_zone');
    expect(await code({ reminders: [{ unit: 'HOURS', amount: 100 }] })).toBe('invalid_reminder');
    expect(await code({ reminders: [0, 1, 2, 3, 4, 5].map((amount) => ({ unit: 'DAYS' as const, amount })) })).toBe('too_many_reminders');
    // Today (in the item's zone) is fine.
    expect(await code({ date: '2026-09-29' })).toBeUndefined();
    expect(runCount()).toBe(0);
  });

  it('enforces Workspace membership, capabilities and scope', async () => {
    await expect(schedule(gus)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(schedule(otto)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    // A Procedure of another Workspace is unknown here.
    await expect(schedule(uma, { procedureId: foreign })).rejects.toBeInstanceOf(ProcedureNotFoundError);
    const item = await schedule();
    // GUESTs see scheduled items; non-members do not; ids of another Workspace are unknown.
    expect((await listOpenSchedules(deps, { actor: gus, workspaceId: home.id })).map((s) => s.id)).toEqual([item.id]);
    await expect(listOpenSchedules(deps, { actor: otto, workspaceId: home.id })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(getSchedule(deps, { actor: otto, workspaceId: office.id, scheduleId: item.id })).rejects.toBeInstanceOf(ScheduleNotFoundError);
    await expect(cancelSchedule(deps, { actor: otto, workspaceId: office.id, scheduleId: item.id, expectedRevision: 1 })).rejects.toBeInstanceOf(ScheduleNotFoundError);
    await expect(startScheduledProcedure(deps, { actor: otto, workspaceId: office.id, scheduleId: item.id })).rejects.toBeInstanceOf(ScheduleNotFoundError);
    await expect(cancelSchedule(deps, { actor: gus, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(startScheduledProcedure(deps, { actor: gus, workspaceId: home.id, scheduleId: item.id })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(getSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: 'not-a-uuid' })).rejects.toBeInstanceOf(DomainValidationError);
    expect(runCount()).toBe(0);
  });

  it('re-checks the actor inside the write transaction', async () => {
    const item = await schedule();
    const users = createUserRepository(database);
    // Demoted between the check and the write: the repository refuses.
    const guardless = { ...deps, workspaces: { ...deps.workspaces, findMembership: async () => ({ role: 'USER' as const }) } };
    await changeMemberRole({ users, workspaces: deps.workspaces, clock: deps.clock }, { actor: admin, workspaceId: home.id, userId: uma.id, role: 'GUEST' });
    await expect(cancelSchedule(guardless as unknown as typeof deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 })).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    expect((await getSchedule(deps, { actor: gus, workspaceId: home.id, scheduleId: item.id })).state).toBe('SCHEDULED');
  });

  it('reschedules with a revision check: unsent reminders are replaced, sent ones never repeat', async () => {
    const item = await schedule();
    // The 7-days reminder was sent already.
    database.sqlite.prepare("UPDATE scheduled_reminders SET processed_at = ? WHERE schedule_id = ? AND reminder_key = 'DAYS:7'").run(now.getTime(), item.id);
    const moved = await rescheduleProcedure(deps, {
      actor: uma,
      workspaceId: home.id,
      scheduleId: item.id,
      expectedRevision: 1,
      date: '2026-10-20',
      timeZone: BERLIN,
      reminders: [{ unit: 'DAYS', amount: 1 }],
    });
    expect(moved).toMatchObject({ date: '2026-10-20', revision: 2, state: 'SCHEDULED' });
    const rows = reminders(item.id);
    expect(rows.filter((r) => r.cancelled === null && r.processed === null).map((r) => [r.key, new Date(r.at).toISOString()])).toEqual([['DAYS:1', '2026-10-19T07:00:00.000Z']]);
    expect(rows.filter((r) => r.processed !== null).map((r) => r.key)).toEqual(['DAYS:7']);
    // Moving back to the original day does not resend the processed 7-day reminder.
    await rescheduleProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 2, date: '2026-10-15', timeZone: BERLIN, reminders: [{ unit: 'DAYS', amount: 7 }] });
    expect(reminders(item.id).filter((r) => r.key === 'DAYS:7').map((r) => r.processed !== null)).toEqual([true]);
    await expect(
      rescheduleProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1, date: '2026-10-21', timeZone: BERLIN, reminders: [] }),
    ).rejects.toBeInstanceOf(ScheduleConflictError);
    expect(auditTypes()).toEqual(['SCHEDULE_CREATED', 'SCHEDULE_CHANGED', 'SCHEDULE_CHANGED']);
  });

  it('cancels: no more reminders, and a cancelled item cannot be changed or started', async () => {
    const item = await schedule();
    const cancelled = await cancelSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 });
    expect(cancelled).toMatchObject({ state: 'CANCELLED', closed: { by: { displayName: 'Uma' } } });
    expect(reminders(item.id).every((r) => r.cancelled !== null)).toBe(true);
    expect(await listOpenSchedules(deps, { actor: uma, workspaceId: home.id })).toEqual([]);
    await expect(cancelSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 2 })).rejects.toBeInstanceOf(ScheduleClosedError);
    await expect(startScheduledProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id })).rejects.toBeInstanceOf(ScheduleClosedError);
    expect(runCount()).toBe(0);
  });

  it('Start creates a normal Run from the Procedure as it is now and closes the item in the same transaction', async () => {
    const item = await schedule();
    now = new Date('2026-10-15T08:00:00Z');
    const run = await startScheduledProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id });
    expect(run.run).toMatchObject({ state: 'ACTIVE', title: 'Buy groceries', startedBy: { displayName: 'Uma' } });
    const closed = await getSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id });
    expect(closed).toMatchObject({ state: 'STARTED', runId: run.run.id, closed: { by: { userId: uma.id } } });
    expect(reminders(item.id).every((r) => r.cancelled !== null)).toBe(true);
    const started = database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type = 'RUN_STARTED'").get() as { metadata: string };
    expect(JSON.parse(started.metadata)).toMatchObject({ scheduleId: item.id });
    // Once only.
    await expect(startScheduledProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id })).rejects.toBeInstanceOf(ScheduleClosedError);
    expect(runCount()).toBe(1);
  });

  it('never starts anything by itself when the date passes', async () => {
    const item = await schedule(uma, { date: '2026-09-30' });
    now = new Date('2026-10-05T12:00:00Z');
    const open = await listOpenSchedules(deps, { actor: uma, workspaceId: home.id });
    expect(open.map((s) => [s.id, s.state, s.runId])).toEqual([[item.id, 'SCHEDULED', null]]);
    expect(runCount()).toBe(0);
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM audit_events WHERE run_id IS NOT NULL').get() as { n: number }).n).toBe(0);
  });

  it('keeps the item when its Procedure is deleted, shows it as unavailable and never starts it', async () => {
    const item = await schedule();
    const procedureDeps = { workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock: deps.clock };
    await deleteProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: groceries });
    const shown = await getSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id });
    expect(shown).toMatchObject({ state: 'SCHEDULED', procedure: { title: 'Buy groceries', deleted: true } });
    await expect(startScheduledProcedure(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id })).rejects.toBeInstanceOf(ScheduledProcedureUnavailableError);
    expect(runCount()).toBe(0);
    // It can still be cancelled; a new item for a deleted Procedure cannot be created.
    await cancelSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 });
    await expect(schedule()).rejects.toBeInstanceOf(ProcedureNotFoundError);
  });

  it('rolls back the item when its audit event cannot be written', async () => {
    database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(schedule()).rejects.toThrow();
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM scheduled_procedures').get() as { n: number }).n).toBe(0);
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM scheduled_reminders').get() as { n: number }).n).toBe(0);
  });

  it('protects items in the database: never deleted, identity fixed, closed items final', async () => {
    const item = await schedule();
    expect(() => database.sqlite.prepare('DELETE FROM scheduled_procedures').run()).toThrow(/never deleted/);
    expect(() => database.sqlite.prepare('UPDATE scheduled_procedures SET procedure_id = ?').run(foreign)).toThrow(/identity is immutable/);
    await cancelSchedule(deps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 });
    expect(() => database.sqlite.prepare("UPDATE scheduled_procedures SET state = 'SCHEDULED'").run()).toThrow(/closed/);
    expect(() => database.sqlite.prepare("UPDATE scheduled_procedures SET date = '2026-12-01'").run()).toThrow(/closed/);
  });
});
