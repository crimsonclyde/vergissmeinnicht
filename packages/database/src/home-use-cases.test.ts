import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProcedureNotFoundError,
  WorkspaceNotFoundError,
  addMember,
  advanceSchedules,
  endSchedule,
  occurrencesInRange,
  pauseSchedule,
  skipOccurrence,
  changeStepState,
  completeRun,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getHome,
  getProcedure,
  listProcedureCards,
  pinProcedure,
  completeOccurrence,
  createSchedule,
  startOccurrence,
  startRun,
  unpinProcedure,
  updateInstanceSettings,
  type HomeDeps,
  type ProcedureInput,
  type RunDeps,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ProcedureId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createInstanceSettingsRepository } from './instance-settings-repository.ts';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureActivityRepository } from './procedure-activity-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const procedure = (title: string): ProcedureInput => ({ title, description: '', icon: 'home', tags: [], sections: [{ title: 'All', description: '', steps: [{ ...STEP, title: 'Do it' }] }] });

describe('Home, Procedure cards, pins and Recent (13.9–13.13)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let deps: HomeDeps;
  let runDeps: RunDeps;
  let scheduleDeps: ScheduleDeps;
  let admin: User;
  let uma: User;
  let cole: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  const ids: Record<string, ProcedureId> = {};
  const clock = { now: () => now };
  const tick = () => (now = new Date(now.getTime() + 60_000));
  const titles = (cards: readonly { procedure: { title: string } }[]) => cards.map((card) => card.procedure.title);

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-29T10:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const procedures = createProcedureRepository(database);
    const runs = createRunRepository(database);
    const schedules = createScheduleRepository(database);
    deps = {
      workspaces,
      procedures,
      activity: createProcedureActivityRepository(database),
      schedules,
      runs,
      settings: createInstanceSettingsRepository(database),
      clock,
    };
    runDeps = { workspaces, runs, clock };
    scheduleDeps = { workspaces, schedules, notificationPreferences: createNotificationPreferencesRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    uma = await user('uma@example.org', 'Uma');
    cole = await user('cole@example.org', 'Cole');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    for (const member of [uma, cole]) await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    for (const title of ['Water plants', 'Buy groceries', 'Leave the house', 'Take out trash']) {
      ids[title] = (await createProcedure({ workspaces, procedures, clock }, { actor: admin, workspaceId: home.id, content: procedure(title) })).procedure.id;
    }
    ids.Foreign = (await createProcedure({ workspaces, procedures, clock }, { actor: admin, workspaceId: office.id, content: procedure('Foreign') })).procedure.id;
  });
  afterEach(() => database.dispose());

  it('keeps pins personal, puts them first, and never writes Workspace history', async () => {
    const auditBefore = database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get();
    await pinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    tick();
    await pinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids['Leave the house'] as ProcedureId });
    await pinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids['Leave the house'] as ProcedureId }); // idempotent
    expect(titles(await listProcedureCards(deps, { actor: uma, workspaceId: home.id }))).toEqual(['Take out trash', 'Leave the house', 'Buy groceries', 'Water plants']);
    expect(titles(await listProcedureCards(deps, { actor: cole, workspaceId: home.id }))).toEqual(['Buy groceries', 'Leave the house', 'Take out trash', 'Water plants']);
    expect(titles((await getHome(deps, { actor: uma, workspaceId: home.id })).pinned)).toEqual(['Take out trash', 'Leave the house']);
    expect((await getHome(deps, { actor: cole, workspaceId: home.id })).pinned).toEqual([]);
    await unpinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    expect(titles((await getHome(deps, { actor: uma, workspaceId: home.id })).pinned)).toEqual(['Leave the house']);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get()).toEqual(auditBefore);
  });

  it('isolates pins by Workspace', async () => {
    await expect(pinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids.Foreign as ProcedureId })).rejects.toBeInstanceOf(ProcedureNotFoundError);
    await expect(pinProcedure(deps, { actor: otto, workspaceId: home.id, procedureId: ids['Buy groceries'] as ProcedureId })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(pinProcedure(deps, { actor: otto, workspaceId: office.id, procedureId: ids['Buy groceries'] as ProcedureId })).rejects.toBeInstanceOf(ProcedureNotFoundError);
    await expect(getHome(deps, { actor: otto, workspaceId: home.id })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM procedure_pins').get() as { n: number }).n).toBe(0);
  });

  it('drops deleted Procedures from pins and Recent', async () => {
    await pinProcedure(deps, { actor: uma, workspaceId: home.id, procedureId: ids['Buy groceries'] as ProcedureId });
    await startRun(runDeps, { actor: uma, workspaceId: home.id, procedureId: ids['Buy groceries'] as ProcedureId });
    await deleteProcedure({ workspaces: deps.workspaces, procedures: deps.procedures, clock }, { actor: admin, workspaceId: home.id, procedureId: ids['Buy groceries'] as ProcedureId });
    const overview = await getHome(deps, { actor: uma, workspaceId: home.id });
    expect(overview.pinned).toEqual([]);
    expect(overview.recent).toEqual([]);
  });

  it('shows as Recent what the person started — not what they opened — newest first, up to the configured limit', async () => {
    for (const title of ['Water plants', 'Buy groceries', 'Water plants', 'Leave the house']) {
      tick();
      await startRun(runDeps, { actor: uma, workspaceId: home.id, procedureId: ids[title] as ProcedureId });
    }
    tick();
    await startRun(runDeps, { actor: cole, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    await getProcedure({ workspaces: deps.workspaces, procedures: deps.procedures, clock }, { actor: uma, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    expect(titles((await getHome(deps, { actor: uma, workspaceId: home.id })).recent)).toEqual(['Leave the house', 'Water plants', 'Buy groceries']);
    expect(titles((await getHome(deps, { actor: cole, workspaceId: home.id })).recent)).toEqual(['Take out trash']);

    const settingsDeps = { settings: deps.settings, clock };
    await updateInstanceSettings(settingsDeps, { actor: admin, settings: { recentProceduresLimit: 2 } });
    expect(await getHome(deps, { actor: uma, workspaceId: home.id })).toMatchObject({ recentLimit: 2 });
    expect(titles((await getHome(deps, { actor: uma, workspaceId: home.id })).recent)).toEqual(['Leave the house', 'Water plants']);
    await updateInstanceSettings(settingsDeps, { actor: admin, settings: { recentProceduresLimit: 0 } });
    expect((await getHome(deps, { actor: uma, workspaceId: home.id })).recent).toEqual([]);
    // Only presentation changes: raising the limit shows everything again.
    await updateInstanceSettings(settingsDeps, { actor: admin, settings: { recentProceduresLimit: 20 } });
    expect(titles((await getHome(deps, { actor: uma, workspaceId: home.id })).recent)).toHaveLength(3);
    for (const bad of [-1, 21, 2.5]) {
      await expect(updateInstanceSettings(settingsDeps, { actor: admin, settings: { recentProceduresLimit: bad } })).rejects.toBeInstanceOf(DomainValidationError);
    }
  });

  it('lists Overdue, Today and Upcoming (by each Occurrence’s own zone), Active and recently done (14.2)', async () => {
    const schedule = (title: string, date: string, timeZone = 'Europe/Berlin') =>
      createSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, procedureId: ids[title] as ProcedureId, date, timeZone, reminders: [] });
    await schedule('Water plants', '2026-09-29');
    await schedule('Buy groceries', '2026-10-03');
    await schedule('Leave the house', '2026-09-30', 'Pacific/Kiritimati'); // UTC+14: already Oct 1 there at 10:00 UTC on Sep 30
    const tax = await createSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, title: 'Pay annual tax', date: '2026-10-01', timeZone: 'Europe/Berlin', reminders: [] });
    await createSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, title: 'Renew passport', date: '2027-04-19', timeZone: 'Europe/Berlin', reminders: [] });
    now = new Date('2026-10-01T10:00:00Z');
    const started = await startRun(runDeps, { actor: cole, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    const done = await startRun(runDeps, { actor: cole, workspaceId: home.id, procedureId: ids['Take out trash'] as ProcedureId });
    await changeStepState(runDeps, { actor: cole, workspaceId: home.id, runId: done.run.id, stepId: done.sections[0]?.steps[0]?.id ?? ('' as never), expectedState: 'PENDING', to: 'DONE' });
    await completeRun(runDeps, { actor: cole, workspaceId: home.id, runId: done.run.id });

    let overview = await getHome(deps, { actor: uma, workspaceId: home.id });
    const titleOf = (item: { schedule: { title: string } }) => item.schedule.title;
    expect(overview.overdue.map((item) => [titleOf(item), item.timeliness])).toEqual([
      ['Water plants', 'OVERDUE'],
      ['Leave the house', 'OVERDUE'],
    ]);
    expect(overview.today.map(titleOf)).toEqual(['Pay annual tax']);
    expect(overview.upcoming.map(titleOf)).toEqual(['Buy groceries']);
    // Upcoming shows 90 days; the passport (200 days ahead) is counted, not lost.
    expect(overview.later).toBe(1);
    expect(overview.active.map((summary) => summary.run.id)).toEqual([started.run.id]);

    // Completing moves the item to "recently done" with who and when; a started Occurrence shows its Run
    // there and not again under Active.
    const taxItem = overview.today[0];
    await completeOccurrence(scheduleDeps, { actor: cole, workspaceId: home.id, occurrenceId: taxItem?.occurrence.id ?? '' });
    const groceriesItem = overview.upcoming[0];
    const linked = await startOccurrence({ ...scheduleDeps, runs: runDeps.runs }, { actor: cole, workspaceId: home.id, occurrenceId: groceriesItem?.occurrence.id ?? '' });
    overview = await getHome(deps, { actor: uma, workspaceId: home.id });
    expect(overview.today).toEqual([]);
    expect(overview.recentlyDone.map((item) => [titleOf(item), item.occurrence.closed?.by.displayName])).toEqual([['Pay annual tax', 'Cole']]);
    expect(overview.upcoming.map((item) => [titleOf(item), item.occurrence.state, item.occurrence.run?.id])).toEqual([['Buy groceries', 'IN_PROGRESS', linked.run.id]]);
    expect(overview.active.map((summary) => summary.run.id)).toEqual([started.run.id]);
    expect(tax.kind).toBe('REMINDER');

    const trash = (await listProcedureCards(deps, { actor: uma, workspaceId: home.id })).find((card) => card.procedure.title === 'Take out trash');
    expect(trash?.activity).toEqual({ lastCompletedAt: now, active: [{ runId: started.run.id, startedBy: 'Cole', startedAt: now }] });
    const water = (await listProcedureCards(deps, { actor: uma, workspaceId: home.id })).find((card) => card.procedure.title === 'Water plants');
    expect(water?.nextOccurrence?.occurrence.dueDate).toBe('2026-09-29');
  });

  describe('calendar read model (14.4)', () => {
    const FIXED = { weekdays: null, lastDayOfMonth: false } as const;
    const reminder = (title: string, date: string, recurrence?: object, timeZone = 'Europe/Berlin') =>
      createSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, title, date, timeZone, reminders: [], ...(recurrence === undefined ? {} : { recurrence: recurrence as never }) });
    const range = (from: string, to: string, actor: User = uma, workspaceId = home.id) => occurrencesInRange(deps, { actor, workspaceId, from, to });
    const stored = (r: Awaited<ReturnType<typeof range>>) => r.occurrences.map((item) => [item.schedule.title, item.occurrence.dueDate, item.occurrence.state]);
    const projected = (r: Awaited<ReturnType<typeof range>>) => r.projected.map((item) => [item.schedule.title, item.dueDate]);

    it('returns stored Occurrences of every state except cancelled, with who closed them', async () => {
      await reminder('Pay annual tax', '2026-10-01');
      await reminder('Renew passport', '2026-10-20');
      const ended = await reminder('Cancel old contract', '2026-10-10');
      await reminder('Later', '2026-11-02');
      const october = await range('2026-10-01', '2026-10-31');
      await completeOccurrence(scheduleDeps, { actor: cole, workspaceId: home.id, occurrenceId: october.occurrences[0]?.occurrence.id ?? '' });
      await skipOccurrence(scheduleDeps, { actor: cole, workspaceId: home.id, occurrenceId: october.occurrences[2]?.occurrence.id ?? '', reason: 'Not needed' });
      await endSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, scheduleId: ended.id, expectedRevision: ended.revision });
      const after = await range('2026-10-01', '2026-10-31');
      expect(stored(after)).toEqual([
        ['Pay annual tax', '2026-10-01', 'COMPLETED'],
        ['Renew passport', '2026-10-20', 'SKIPPED'],
      ]);
      expect(after.occurrences.map((item) => item.occurrence.closed?.by.displayName)).toEqual(['Cole', 'Cole']);
      expect(after.projected).toEqual([]);
      expect(after.truncated).toBe(false);
      // The same rows Home shows: the open one of November is Upcoming there and stored here.
      const home2 = await getHome(deps, { actor: uma, workspaceId: home.id });
      expect(home2.upcoming.map((item) => item.occurrence.id)).toEqual((await range('2026-11-01', '2026-11-30')).occurrences.map((item) => item.occurrence.id));
    });

    it('projects active fixed series — years ahead, across year ends — and nothing else', async () => {
      await reminder('Pay rent', '2026-10-31', { kind: 'FIXED', unit: 'MONTH', interval: 1, ...FIXED });
      await reminder('Tax return', '2027-01-01', { kind: 'FIXED', unit: 'YEAR', interval: 1, ...FIXED }, 'Pacific/Kiritimati');
      await reminder('Descale', '2026-10-05', { kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 1 });
      await reminder('One time', '2026-10-06');
      const paused = await reminder('Paused', '2026-10-07', { kind: 'FIXED', unit: 'WEEK', interval: 1, ...FIXED });
      await pauseSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, scheduleId: paused.id, expectedRevision: paused.revision });
      const ended = await reminder('Ended', '2026-10-08', { kind: 'FIXED', unit: 'WEEK', interval: 1, ...FIXED });
      await endSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, scheduleId: ended.id, expectedRevision: ended.revision });
      const gone = await createSchedule(scheduleDeps, {
        actor: uma,
        workspaceId: home.id,
        procedureId: ids['Buy groceries'] as ProcedureId,
        date: '2026-10-09',
        timeZone: 'Europe/Berlin',
        reminders: [],
        recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 1, ...FIXED },
      });
      await deleteProcedure({ workspaces: deps.workspaces, procedures: deps.procedures, clock }, { actor: admin, workspaceId: home.id, procedureId: ids['Buy groceries'] as ProcedureId });
      expect(gone.kind).toBe('PROCEDURE');

      // October: the first Occurrences exist; the series are not projected onto their own stored dates.
      const october = await range('2026-10-01', '2026-10-31');
      expect(stored(october).map(([title]) => title)).toEqual(['Descale', 'One time', 'Paused', 'Buy groceries', 'Pay rent']);
      expect(projected(october)).toEqual([]);
      // Across the year end: the clamped monthly date and the yearly one (a calendar date in its own zone).
      expect(projected(await range('2026-11-01', '2027-01-31'))).toEqual([
        ['Pay rent', '2026-11-30'],
        ['Pay rent', '2026-12-31'],
        ['Pay rent', '2027-01-31'],
      ]);
      expect(stored(await range('2026-12-28', '2027-01-31'))).toEqual([['Tax return', '2027-01-01', 'OPEN']]);
      // Years ahead.
      expect(projected(await range('2031-01-01', '2031-02-28'))).toEqual([
        ['Tax return', '2031-01-01'],
        ['Pay rent', '2031-01-31'],
        ['Pay rent', '2031-02-28'],
      ]);
    });

    it('agrees with the generator: a projected date becomes exactly one stored Occurrence', async () => {
      await reminder('Pay rent', '2026-10-15', { kind: 'FIXED', unit: 'MONTH', interval: 1, ...FIXED });
      expect(projected(await range('2026-11-01', '2026-11-30'))).toEqual([['Pay rent', '2026-11-15']]);
      now = new Date('2026-10-16T10:00:00Z');
      await advanceSchedules(scheduleDeps);
      const november = await range('2026-11-01', '2026-11-30');
      expect(stored(november)).toEqual([['Pay rent', '2026-11-15', 'OPEN']]);
      expect(projected(november)).toEqual([]);
      expect(projected(await range('2026-12-01', '2026-12-31'))).toEqual([['Pay rent', '2026-12-15']]);
    });

    it('is Workspace-scoped and needs membership', async () => {
      await reminder('Pay rent', '2026-10-15', { kind: 'FIXED', unit: 'MONTH', interval: 1, ...FIXED });
      await expect(range('2026-10-01', '2026-11-30', otto)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
      const office2 = await range('2026-10-01', '2026-11-30', otto, office.id);
      expect([office2.occurrences, office2.projected]).toEqual([[], []]);
      // Reading needs no more than a member may see anyway.
      expect(stored(await range('2026-10-01', '2026-10-31', cole))).toEqual([['Pay rent', '2026-10-15', 'OPEN']]);
    });

    it('refuses invalid ranges', async () => {
      const code = async (from: string, to: string) => {
        try {
          await range(from, to);
          return undefined;
        } catch (error) {
          expect(error).toBeInstanceOf(DomainValidationError);
          return (error as DomainValidationError).code;
        }
      };
      expect(await code('2026-10-31', '2026-10-01')).toBe('invalid_range');
      expect(await code('2026-10-01', '2027-01-01')).toBe('invalid_range');
      expect(await code('2026-10-01', '2026-12-31')).toBeUndefined();
      expect(await code('2026-02-30', '2026-03-01')).toBe('invalid_date');
      expect(await code("2026-10-01' OR 1=1", '2026-10-31')).toBe('invalid_date');
    });

    it('stays bounded and fast with 1000 active series', async () => {
      for (let i = 0; i < 1000; i++) {
        await reminder(`Series ${i}`, '2026-10-01', { kind: 'FIXED', unit: i % 2 === 0 ? 'WEEK' : 'MONTH', interval: 1, ...FIXED });
      }
      const started = performance.now();
      const november = await range('2026-11-01', '2026-11-30');
      const elapsed = performance.now() - started;
      // 500 weekly series × 5 dates + 500 monthly × 1 = 3000 projected dates: cut to the limit and marked.
      expect(november.projected).toHaveLength(2000);
      expect(november.truncated).toBe(true);
      expect((await range('2026-10-01', '2026-10-01')).occurrences).toHaveLength(1000);
      expect(elapsed).toBeLessThan(2000);
    }, 60_000);
  });
});
