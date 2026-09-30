import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProcedureNotFoundError,
  WorkspaceNotFoundError,
  addMember,
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
import { createWorkspaceRepository } from './workspace-repository.ts';

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
});
