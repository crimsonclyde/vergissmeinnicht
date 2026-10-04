import { afterEach, beforeEach, expect, it } from 'vitest';
import { addMember, changeStepState, completeOccurrence, completeRun, createProcedure, createSchedule, createWorkspace, getOccurrence, getTodayProgress, reopenOccurrence, setWorkspaceTool, skipOccurrence, startOccurrence, startRun, type RunDeps, type ScheduleDeps, type TodayDeps } from '@vergissmeinnicht/application';
import { normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createTestDatabase, createConfiguredWorkspaceRepository } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createWorkspaceToolRepository } from './document-repository.ts';
import { createTodayRepository } from './today-repository.ts';

let database: ReturnType<typeof createTestDatabase>;
let owner: User;
let member: User;
let home: Workspace;
let other: Workspace;
let now: Date;
let deps: TodayDeps;
let scheduleDeps: ScheduleDeps;
let runDeps: RunDeps;
let procedureId: Awaited<ReturnType<typeof createProcedure>>['procedure']['id'];
const clock = { now: () => now };
const read = (filter: 'ALL' | 'MINE' | 'SHARED' = 'ALL', actor = owner, workspaceId = home.id) => getTodayProgress(deps, { actor, workspaceId, filter });
const reminder = (title: string, zone = 'UTC', assigneeUserId: string | null = null) => createSchedule(scheduleDeps, { actor: owner, workspaceId: home.id, title, date: now.toISOString().slice(0, 10), timeZone: zone, assigneeUserId, reminders: [] });
const occurrence = async (scheduleId: string) => (await scheduleDeps.schedules.history(home.id, scheduleId as Parameters<typeof scheduleDeps.schedules.history>[1], 20))[0]?.occurrence.id;
const finish = async (detail: Awaited<ReturnType<typeof startRun>>) => {
  for (const section of detail.sections) for (const step of section.steps) await changeStepState(runDeps, { actor: owner, workspaceId: home.id, runId: detail.run.id, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
  await completeRun(runDeps, { actor: owner, workspaceId: home.id, runId: detail.run.id });
};
beforeEach(async () => {
  database = createTestDatabase();
  now = new Date('2026-10-04T10:00:00Z');
  const users = createUserRepository(database);
  owner = await users.create({ email: normalizeEmail('owner@example.org'), displayName: 'Owner', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
  member = await users.create({ email: normalizeEmail('member@example.org'), displayName: 'Member', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
  const workspaces = createConfiguredWorkspaceRepository(database);
  home = await createWorkspace({ workspaces, users, clock }, { actor: owner, name: 'Home' });
  other = await createWorkspace({ workspaces, users, clock }, { actor: owner, name: 'Other' });
  await addMember({ workspaces, users, clock }, { actor: owner, workspaceId: home.id, email: member.email, role: 'GUEST' });
  deps = { workspaces, progress: createTodayRepository(database), clock };
  scheduleDeps = { workspaces, schedules: createScheduleRepository(database), notificationPreferences: createNotificationPreferencesRepository(database), clock };
  runDeps = { workspaces, runs: createRunRepository(database), clock };
  procedureId = (await createProcedure({ workspaces, procedures: createProcedureRepository(database), clock }, { actor: owner, workspaceId: home.id, content: { title: 'Check the stove', description: '', icon: 'home', tags: [], sections: [{ title: 'Kitchen', description: '', steps: [{ title: 'Stove off', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' }] }] } })).procedure.id;
});
afterEach(() => database.dispose());

it('counts canonical completion, undo and skip separately, applies assignment filters, and isolates Workspaces', async () => {
  const shared = await reminder('Shared');
  const mine = await reminder('Assigned', 'UTC', owner.id);
  const sharedId = await occurrence(shared.id);
  const mineId = await occurrence(mine.id);
  if (sharedId === undefined || mineId === undefined) throw new Error('missing occurrences');
  expect(await read()).toMatchObject({ completedOccurrencesToday: 0, dueToday: 2, weekFrom: '2026-09-28', weekTo: '2026-10-04' });
  await completeOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: mineId });
  expect(await read('MINE')).toMatchObject({ completedOccurrencesToday: 1, dueToday: 0 });
  expect(await read('SHARED')).toMatchObject({ completedOccurrencesToday: 0, dueToday: 1, recentlyCompleted: [] });
  expect((await read('ALL', member)).completedOccurrencesToday).toBe(1);
  expect((await read('ALL', owner, other.id)).completedOccurrencesToday).toBe(0);
  await expect(read('ALL', member, other.id)).rejects.toThrow();
  await reopenOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: mineId });
  expect(await read()).toMatchObject({ completedOccurrencesToday: 0, dueToday: 2, recentlyCompleted: [] });
  await skipOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: sharedId });
  expect(await read()).toMatchObject({ completedOccurrencesToday: 0, dueToday: 1, recentlyCompleted: [] });
});

it('keeps Runs and Occurrences separate and deduplicates linked completions; hidden tools contribute nothing', async () => {
  const schedule = await createSchedule(scheduleDeps, { actor: owner, workspaceId: home.id, procedureId, date: '2026-10-04', timeZone: 'UTC', reminders: [] });
  const id = await occurrence(schedule.id);
  if (id === undefined) throw new Error('missing occurrence');
  const detail = await startOccurrence({ ...scheduleDeps, ...runDeps }, { actor: owner, workspaceId: home.id, occurrenceId: id });
  expect((await read()).activeRuns).toBe(1);
  await finish(detail);
  const progress = await read();
  expect(progress).toMatchObject({ activeRuns: 0, completedOccurrencesToday: 1, completedRunsThisWeek: 1 });
  expect(progress.recentlyCompleted).toHaveLength(1);
  const tools = createWorkspaceToolRepository(database);
  await setWorkspaceTool({ workspaces: deps.workspaces, tools, clock }, { actor: owner, workspaceId: home.id, tool: 'PROCEDURES', enabled: false });
  expect(await read()).toMatchObject({ activeRuns: null, completedRunsThisWeek: null, completedOccurrencesToday: 0, recentlyCompleted: [] });
  await expect(getOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: id })).rejects.toThrow();
  await setWorkspaceTool({ workspaces: deps.workspaces, tools, clock }, { actor: owner, workspaceId: home.id, tool: 'PROCEDURES', enabled: true });
  expect(await read()).toMatchObject({ completedRunsThisWeek: 1, completedOccurrencesToday: 1 });
  now = new Date('2026-10-05T00:00:00Z');
  expect(await read()).toMatchObject({ completedRunsThisWeek: 0, weekFrom: '2026-10-05', weekTo: '2026-10-11' });
});

it('uses Schedule-local completion days across midnight and DST, and bounds recent activity', async () => {
  now = new Date('2026-10-24T10:00:00Z');
  const schedule = await reminder('Berlin', 'Europe/Berlin');
  const id = await occurrence(schedule.id);
  if (id === undefined) throw new Error('missing occurrence');
  now = new Date('2026-10-25T00:30:00Z'); // 02:30 before fall-back
  await completeOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: id });
  now = new Date('2026-10-25T01:30:00Z'); // 02:30 again; still the same local day
  expect((await read()).completedOccurrencesToday).toBe(1);
  now = new Date('2026-10-25T23:00:00Z'); // Berlin is now Oct 26
  expect((await read()).completedOccurrencesToday).toBe(0);
  for (let index = 0; index < 14; index++) {
    const item = await reminder(`Completed ${index}`);
    const itemId = await occurrence(item.id);
    if (itemId === undefined) throw new Error('missing occurrence');
    await completeOccurrence(scheduleDeps, { actor: owner, workspaceId: home.id, occurrenceId: itemId });
  }
  expect((await read()).recentlyCompleted).toHaveLength(10);
});
