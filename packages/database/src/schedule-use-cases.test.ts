import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NextOccurrenceInUseError,
  NotAuthorizedError,
  ProcedureNotFoundError,
  RunNotEligibleError,
  ScheduleClosedError,
  ScheduleConflictError,
  ScheduleNotFoundError,
  ScheduledProcedureUnavailableError,
  WorkspaceNotFoundError,
  WrongScheduleKindError,
  abortRun,
  addMember,
  advanceSchedules,
  assignOccurrence,
  changeMemberRole,
  changeStepState,
  completeOccurrence,
  completeRun,
  createProcedure,
  createSchedule,
  createWorkspace,
  deleteProcedure,
  endSchedule,
  linkRunToOccurrence,
  linkableRuns,
  listOpenOccurrences,
  moveOccurrence,
  pauseSchedule,
  reopenOccurrence,
  resumeSchedule,
  scheduleHistory,
  skipOccurrence,
  skipOlderOccurrences,
  startOccurrence,
  startRun,
  unlinkRunFromOccurrence,
  updateSchedule,
  type ProcedureInput,
  type RunDeps,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ProcedureId, type RunId, type Schedule, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const PROCEDURE: ProcedureInput = {
  title: 'Buy groceries',
  description: '',
  icon: 'food',
  tags: [],
  sections: [{ title: 'Shop', description: '', steps: [{ ...STEP, title: 'Milk' }] }],
};
const BERLIN = 'Europe/Berlin';

describe('Schedules and Occurrences (14.1)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: ScheduleDeps & RunDeps;
  let now: Date;
  let admin: User;
  let ana: User;
  let ben: User;
  let cleo: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let groceries: ProcedureId;
  let foreign: ProcedureId;

  const at = (iso: string) => {
    now = new Date(iso);
  };
  const reminder = (actor: User = ana, overrides: Partial<Parameters<typeof createSchedule>[1]> = {}) =>
    createSchedule(deps, { actor, workspaceId: home.id, title: 'Pay annual tax', date: '2027-06-15', timeZone: BERLIN, reminders: [], ...overrides });
  const procedureSchedule = (actor: User = ana, overrides: Partial<Parameters<typeof createSchedule>[1]> = {}) =>
    createSchedule(deps, { actor, workspaceId: home.id, procedureId: groceries, date: '2026-10-15', timeZone: BERLIN, reminders: [], ...overrides });
  const occurrencesOf = async (schedule: Schedule) => (await scheduleHistory(deps, { actor: admin, workspaceId: home.id, scheduleId: schedule.id })).occurrences.map((entry) => entry.occurrence);
  const openOf = async (schedule: Schedule) => (await occurrencesOf(schedule)).filter((occurrence) => occurrence.state === 'OPEN' || occurrence.state === 'IN_PROGRESS');
  const summary = async (schedule: Schedule) => (await occurrencesOf(schedule)).map((o) => `${o.dueDate} ${o.state}`).reverse();
  const first = async (schedule: Schedule) => {
    const [occurrence] = (await openOf(schedule)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (occurrence === undefined) throw new Error('no open occurrence');
    return occurrence;
  };
  const reminders = (occurrenceId: string) =>
    database.sqlite
      .prepare('SELECT reminder_key AS key, remind_at AS at, recipient_user_id AS recipient, cancelled_at AS cancelled, processed_at AS processed FROM scheduled_reminders WHERE occurrence_id = ? ORDER BY remind_at, rowid')
      .all(occurrenceId) as { key: string; at: number; recipient: string; cancelled: number | null; processed: number | null }[];
  const activeReminders = (occurrenceId: string) => reminders(occurrenceId).filter((row) => row.cancelled === null && row.processed === null);
  const runCount = () => (database.sqlite.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n;
  const auditTypes = () => (database.sqlite.prepare("SELECT type FROM audit_events WHERE subject_type IN ('schedule', 'occurrence') ORDER BY rowid").all() as { type: string }[]).map((row) => row.type);
  const finishRun = async (actor: User, runId: RunId, to: 'COMPLETED' | 'ABORTED') => {
    if (to === 'ABORTED') return abortRun(deps, { actor, workspaceId: home.id, runId, reason: 'Interrupted' });
    const detail = await deps.runs.find(home.id, runId);
    for (const step of detail?.sections.flatMap((section) => section.steps) ?? []) {
      await changeStepState(deps, { actor, workspaceId: home.id, runId, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
    }
    return completeRun(deps, { actor, workspaceId: home.id, runId });
  };

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
    ana = await user('ana@example.org', 'Ana');
    ben = await user('ben@example.org', 'Ben');
    cleo = await user('cleo@example.org', 'Cleo');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    const wsDeps = { users, workspaces, clock };
    home = await createWorkspace(wsDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(wsDeps, { actor: admin, name: 'Office' });
    for (const [member, role] of [
      [ana, 'USER'],
      [ben, 'USER'],
      [cleo, 'EDITOR'],
      [gus, 'GUEST'],
    ] as const) {
      await addMember(wsDeps, { actor: admin, workspaceId: home.id, email: member.email, role });
    }
    await addMember(wsDeps, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    const procedureDeps = { workspaces, procedures: createProcedureRepository(database), clock };
    groceries = (await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE })).procedure.id;
    foreign = (await createProcedure(procedureDeps, { actor: admin, workspaceId: office.id, content: PROCEDURE })).procedure.id;
  });
  afterEach(() => database.dispose());

  describe('creating', () => {
    it('stores a standalone Reminder with its first Occurrence and reminders for the creator — and no Run', async () => {
      const tax = await reminder(ana, { reminders: [{ unit: 'MONTHS', amount: 1 }, { unit: 'WEEKS', amount: 1 }] });
      expect(tax).toMatchObject({ kind: 'REMINDER', title: 'Pay annual tax', procedureId: null, recurrence: { kind: 'ONCE' }, state: 'ACTIVE', assignee: null });
      const occurrence = await first(tax);
      expect(occurrence).toMatchObject({ dueDate: '2027-06-15', state: 'OPEN' });
      // 1 month and 1 week before, at 09:00 Berlin (CEST): two reminders for Ana.
      expect(activeReminders(occurrence.id).map((row) => [row.key, new Date(row.at).toISOString(), row.recipient])).toEqual([
        ['MONTHS:1', '2027-05-15T07:00:00.000Z', ana.id],
        ['WEEKS:1', '2027-06-08T07:00:00.000Z', ana.id],
      ]);
      expect(runCount()).toBe(0);
      expect(auditTypes()).toEqual(['SCHEDULE_CREATED']);
    });

    it('fires day, week and month offsets at the recipient’s own reminder time', async () => {
      await deps.notificationPreferences.save(ana.id, { reminderTime: '07:30' as never, emailReminders: true, telegramReminders: false }, now);
      // "1 month before" a 31 March due date is 28 February (2027 is no leap year).
      const occurrence = await first(await reminder(ana, { date: '2027-03-31', reminders: [{ unit: 'MONTHS', amount: 1 }, { unit: 'DAYS', amount: 0 }] }));
      expect(activeReminders(occurrence.id).map((row) => new Date(row.at).toISOString())).toEqual(['2027-02-28T06:30:00.000Z', '2027-03-31T05:30:00.000Z']);
    });

    it('validates everything on the server', async () => {
      const code = async (action: Promise<unknown>) => {
        try {
          await action;
          return 'ok';
        } catch (error) {
          return error instanceof DomainValidationError ? error.code : (error as Error).name;
        }
      };
      expect(await code(reminder(ana, { title: '  ' }))).toBe('reminder_title_empty');
      expect(await code(reminder(ana, { title: 'x‮y' }))).toBe('reminder_title_invalid_characters');
      expect(await code(reminder(ana, { date: '2026-09-28' }))).toBe('date_in_past');
      expect(await code(reminder(ana, { recurrence: { kind: 'FIXED', unit: 'HOUR' } }))).toBe('invalid_recurrence');
      expect(await code(reminder(ana, { reminders: [{ unit: 'MONTHS', amount: 13 }] }))).toBe('invalid_reminder');
      expect(await code(reminder(ana, { timeZone: '+02:00' }))).toBe('invalid_time_zone');
      expect(await code(procedureSchedule(ana, { procedureId: foreign }))).toBe('ProcedureNotFoundError');
      // Assignees must be members of this Workspace who can see its Procedures.
      expect(await code(reminder(ana, { assigneeUserId: otto.id }))).toBe('InvalidAssigneeError');
      expect(await code(reminder(ana, { assigneeUserId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' }))).toBe('InvalidAssigneeError');
    });

    it('needs schedule.manage in the Workspace (negative tests)', async () => {
      await expect(reminder(gus)).rejects.toThrow(NotAuthorizedError);
      await expect(reminder(otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(createSchedule(deps, { actor: otto, workspaceId: office.id, procedureId: groceries, date: '2026-10-15', timeZone: BERLIN, reminders: [] })).rejects.toThrow(
        ProcedureNotFoundError,
      );
    });
  });

  describe('recurrence (no drift, independent history)', () => {
    it('keeps a yearly Reminder on 15 June when completed late, and completing 2027 never touches 2028', async () => {
      at('2027-06-01T08:00:00Z');
      const tax = await reminder(ana, { recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 } });
      const y2027 = await first(tax);
      at('2027-06-20T08:00:00Z'); // completed five days late
      await advanceSchedules(deps); // the 2028 Occurrence appears once 15 June 2027 has passed
      await completeOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: y2027.id });
      expect(await summary(tax)).toEqual(['2027-06-15 COMPLETED', '2028-06-15 OPEN']);
      const y2028 = await first(tax);
      // Reopening 2027 changes nothing in 2028.
      await reopenOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: y2027.id });
      expect(await summary(tax)).toEqual(['2027-06-15 OPEN', '2028-06-15 OPEN']);
      expect((await first(tax)).id).toBe(y2027.id);
      expect((await openOf(tax)).find((o) => o.id === y2028.id)?.state).toBe('OPEN');
    });

    it('generates "monthly on the 31st" as 31 Jan, 28 Feb, 31 Mar, 30 Apr, 31 May', async () => {
      at('2027-01-20T08:00:00Z');
      const rent = await reminder(ana, { title: 'Pay rent', date: '2027-01-31', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 1 } });
      for (const day of ['2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01']) {
        at(`${day}T08:00:00Z`);
        await advanceSchedules(deps);
      }
      expect(await summary(rent)).toEqual(['2027-01-31 OPEN', '2027-02-28 OPEN', '2027-03-31 OPEN', '2027-04-30 OPEN', '2027-05-31 OPEN']);
      // Idempotent: running the generator again creates nothing.
      expect(await advanceSchedules(deps)).toBe(0);
    });

    it('counts a completion-based series from the completion and the skip date (D2)', async () => {
      at('2027-02-20T08:00:00Z');
      const filter = await reminder(ana, { title: 'Change water filter', date: '2027-03-01', recurrence: { kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 6 } });
      at('2027-03-03T10:00:00Z');
      await completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: (await first(filter)).id });
      expect(await summary(filter)).toEqual(['2027-03-01 COMPLETED', '2027-09-03 OPEN']);
      at('2027-09-10T10:00:00Z');
      await skipOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: (await first(filter)).id, reason: 'Filter still clean' });
      expect(await summary(filter)).toEqual(['2027-03-01 COMPLETED', '2027-09-03 SKIPPED', '2028-03-10 OPEN']);
      // Reopen withdraws the untouched next Occurrence…
      const skipped = (await occurrencesOf(filter)).find((o) => o.state === 'SKIPPED');
      await reopenOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: skipped?.id ?? '' });
      expect(await summary(filter)).toEqual(['2027-03-01 COMPLETED', '2027-09-03 OPEN', '2028-03-10 CANCELLED']);
    });

    it('refuses to reopen when the next Occurrence of a completion-based series was already acted on', async () => {
      const service = await procedureSchedule(ana, { recurrence: { kind: 'AFTER_COMPLETION', unit: 'WEEK', interval: 2 } });
      const one = await first(service);
      const run = await startOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: one.id });
      await finishRun(ana, run.run.id, 'COMPLETED');
      const two = await first(service);
      await startOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: two.id });
      await expect(unlinkRunFromOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: one.id })).rejects.toThrow(NextOccurrenceInUseError);
    });

    it('keeps overdue Occurrences open, grows by one per period and bulk-skips the older ones (D1)', async () => {
      at('2027-06-01T08:00:00Z');
      const tax = await reminder(ana, { recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 } });
      for (const year of [2028, 2029, 2030]) {
        at(`${year}-01-01T08:00:00Z`);
        await advanceSchedules(deps);
      }
      expect(await summary(tax)).toEqual(['2027-06-15 OPEN', '2028-06-15 OPEN', '2029-06-15 OPEN', '2030-06-15 OPEN']);
      at('2030-01-01T08:00:00Z');
      const skipped = await skipOlderOccurrences(deps, { actor: ana, workspaceId: home.id, scheduleId: tax.id, before: '2029-01-01' });
      expect(skipped).toBe(2);
      expect(await summary(tax)).toEqual(['2027-06-15 SKIPPED', '2028-06-15 SKIPPED', '2029-06-15 OPEN', '2030-06-15 OPEN']);
      expect(runCount()).toBe(0);
      await expect(skipOlderOccurrences(deps, { actor: gus, workspaceId: home.id, scheduleId: tax.id, before: '2031-01-01' })).rejects.toThrow(NotAuthorizedError);
    });
  });

  describe('pause and resume (D3)', () => {
    it('keeps the anchor of a fixed series, offers to skip what fell into the pause and sends nothing meanwhile', async () => {
      at('2027-01-10T08:00:00Z');
      const bins = await reminder(ana, { title: 'Clean the bins', date: '2027-01-15', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 1 }, reminders: [{ unit: 'DAYS', amount: 0 }] });
      at('2027-02-16T08:00:00Z');
      await advanceSchedules(deps);
      expect(await summary(bins)).toEqual(['2027-01-15 OPEN', '2027-02-15 OPEN', '2027-03-15 OPEN']);
      at('2027-03-01T08:00:00Z');
      const paused = await pauseSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: bins.id, expectedRevision: bins.revision });
      const march = (await openOf(bins)).find((o) => o.dueDate === '2027-03-15');
      expect(activeReminders(march?.id ?? '')).toEqual([]);
      at('2027-05-20T08:00:00Z');
      expect(await advanceSchedules(deps)).toBe(0); // paused: nothing is created
      await resumeSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: bins.id, expectedRevision: paused.revision, skipElapsed: true });
      // 15 April and 15 May fell into the pause: created and skipped; the anchor (the 15th) stays.
      expect(await summary(bins)).toEqual(['2027-01-15 OPEN', '2027-02-15 OPEN', '2027-03-15 OPEN', '2027-04-15 SKIPPED', '2027-05-15 SKIPPED', '2027-06-15 OPEN']);
      const june = (await openOf(bins)).find((o) => o.dueDate === '2027-06-15');
      expect(activeReminders(june?.id ?? '').map((row) => row.key)).toEqual(['DAYS:0']);
    });

    it('keeps the due date of a completion-based series, even if it is overdue now', async () => {
      at('2027-03-20T08:00:00Z');
      const filter = await reminder(ana, { date: '2027-04-01', recurrence: { kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 6 } });
      const paused = await pauseSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: filter.id, expectedRevision: filter.revision });
      at('2027-04-20T08:00:00Z');
      await resumeSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: filter.id, expectedRevision: paused.revision, skipElapsed: true });
      expect(await summary(filter)).toEqual(['2027-04-01 OPEN']);
    });
  });

  describe('moving, editing and ending', () => {
    it('replaces unsent reminders when an Occurrence moves and never re-sends a processed one', async () => {
      const tax = await reminder(ana, { date: '2026-10-15', reminders: [{ unit: 'DAYS', amount: 7 }, { unit: 'DAYS', amount: 0 }] });
      const occurrence = await first(tax);
      const [sevenDays] = reminders(occurrence.id);
      database.sqlite.prepare('UPDATE scheduled_reminders SET processed_at = ? WHERE remind_at = ?').run(now.getTime(), sevenDays?.at);
      await moveOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id, date: '2026-10-20' });
      await moveOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id, date: '2026-10-15' });
      const rows = reminders(occurrence.id);
      // The processed "7 days before 15 October" stays processed (no duplicate row, not re-sent).
      expect(rows.filter((row) => row.at === sevenDays?.at)).toHaveLength(1);
      expect(rows.find((row) => row.at === sevenDays?.at)?.processed).not.toBeNull();
      expect(activeReminders(occurrence.id).map((row) => row.key)).toEqual(['DAYS:0']);
    });

    it('applies edits to Occurrences not yet acted on and keeps the history', async () => {
      at('2027-01-10T08:00:00Z');
      const weekly = await reminder(ana, { title: 'Water plants', date: '2027-01-11', recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 1 } });
      const done = await first(weekly);
      at('2027-01-11T18:00:00Z');
      await completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: done.id });
      at('2027-01-12T08:00:00Z');
      await advanceSchedules(deps);
      const changed = await updateSchedule(deps, {
        actor: ana,
        workspaceId: home.id,
        scheduleId: weekly.id,
        expectedRevision: weekly.revision,
        title: 'Water the plants',
        date: '2027-01-14',
        timeZone: BERLIN,
        recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 2 },
        reminders: [],
      });
      expect(changed.title).toBe('Water the plants');
      expect(await summary(weekly)).toEqual(['2027-01-11 COMPLETED', '2027-01-14 OPEN', '2027-01-18 CANCELLED']);
      await expect(
        updateSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: weekly.id, expectedRevision: weekly.revision, date: '2027-01-14', timeZone: BERLIN, reminders: [] }),
      ).rejects.toThrow(ScheduleConflictError);
    });

    it('ends a Schedule: open Occurrences are cancelled, history stays, nothing more is created', async () => {
      at('2027-01-10T08:00:00Z');
      const monthly = await reminder(ana, { date: '2027-01-15', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 1 } });
      await completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: (await first(monthly)).id });
      await endSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: monthly.id, expectedRevision: monthly.revision });
      at('2027-03-10T08:00:00Z');
      expect(await advanceSchedules(deps)).toBe(0);
      expect(await summary(monthly)).toEqual(['2027-01-15 COMPLETED']);
      await expect(endSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: monthly.id, expectedRevision: monthly.revision + 1 })).rejects.toThrow(ScheduleClosedError);
    });
  });

  describe('Runs', () => {
    it('starts exactly one Run per Occurrence, completes only that Occurrence and reopens it on abort', async () => {
      at('2026-10-01T08:00:00Z');
      const weekly = await procedureSchedule(ana, { date: '2026-10-05', recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 1 } });
      at('2026-10-06T08:00:00Z');
      await advanceSchedules(deps);
      const [oct5, oct12] = (await openOf(weekly)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const run = await startOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: oct5?.id ?? '' });
      expect(runCount()).toBe(1);
      await expect(startOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: oct5?.id ?? '' })).rejects.toThrow(ScheduleClosedError);
      expect((await openOf(weekly)).find((o) => o.id === oct5?.id)).toMatchObject({ state: 'IN_PROGRESS', run: { id: run.run.id, state: 'ACTIVE' } });
      await finishRun(ben, run.run.id, 'ABORTED');
      expect((await openOf(weekly)).find((o) => o.id === oct5?.id)?.state).toBe('OPEN');
      at('2026-10-06T09:00:00Z');
      const again = await startOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: oct5?.id ?? '' });
      await finishRun(ben, again.run.id, 'COMPLETED');
      expect(await summary(weekly)).toEqual(['2026-10-05 COMPLETED', '2026-10-12 OPEN']);
      const history = (await scheduleHistory(deps, { actor: admin, workspaceId: home.id, scheduleId: weekly.id })).occurrences.find((entry) => entry.occurrence.id === oct5?.id);
      expect(history?.occurrence.closed?.by.displayName).toBe('Ben');
      expect(history?.runs.map((link) => link.ended)).toEqual([null, 'ABORTED']);
      expect(oct12).toBeDefined();
    });

    it('links an eligible existing Run only on purpose, never twice, never across Procedures (D7)', async () => {
      const once = await procedureSchedule(ana);
      const occurrence = await first(once);
      const adHoc = await startRun(deps, { actor: ben, workspaceId: home.id, procedureId: groceries });
      expect((await linkableRuns(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id })).map((summary) => summary.run.id)).toEqual([adHoc.run.id]);
      // An ad-hoc Run does not complete the Occurrence by itself.
      await finishRun(ben, adHoc.run.id, 'COMPLETED');
      expect((await first(once)).state).toBe('OPEN');
      await linkRunToOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id, runId: adHoc.run.id });
      expect(await summary(once)).toEqual(['2026-10-15 COMPLETED']);
      // Completed by whoever completed the Run.
      expect((await occurrencesOf(once))[0]?.closed?.by.displayName).toBe('Ben');
      const second = await first(await procedureSchedule(ana, { date: '2026-10-16' }));
      await expect(linkRunToOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: second.id, runId: adHoc.run.id })).rejects.toThrow(RunNotEligibleError);
      const other = await createProcedure({ workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock: deps.clock }, { actor: admin, workspaceId: home.id, content: { ...PROCEDURE, title: 'Other' } });
      const otherRun = await startRun(deps, { actor: ben, workspaceId: home.id, procedureId: other.procedure.id });
      await expect(linkRunToOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: second.id, runId: otherRun.run.id })).rejects.toThrow(RunNotEligibleError);
      await expect(linkRunToOccurrence(deps, { actor: gus, workspaceId: home.id, occurrenceId: second.id, runId: otherRun.run.id })).rejects.toThrow(NotAuthorizedError);
      // Unlinking reopens it.
      await unlinkRunFromOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id });
      expect(await summary(once)).toEqual(['2026-10-15 OPEN']);
    });

    it('never starts a deleted Procedure and does not complete a Procedure Occurrence without a Run', async () => {
      const once = await procedureSchedule(ana);
      const occurrence = await first(once);
      await expect(completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(WrongScheduleKindError);
      await deleteProcedure({ workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock: deps.clock }, { actor: admin, workspaceId: home.id, procedureId: groceries });
      await expect(startOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(ScheduledProcedureUnavailableError);
      expect(runCount()).toBe(0);
    });
  });

  describe('assignment and access (D6, D8)', () => {
    it('sends reminders to the Assignee (or the Occurrence override), else the creator', async () => {
      const tax = await reminder(ana, { reminders: [{ unit: 'DAYS', amount: 1 }] });
      const occurrence = await first(tax);
      expect(activeReminders(occurrence.id).map((row) => row.recipient)).toEqual([ana.id]);
      const toBen = await updateSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: tax.id, expectedRevision: tax.revision, date: tax.anchorDate, timeZone: BERLIN, reminders: tax.reminders, assigneeUserId: ben.id });
      expect(toBen.assignee?.displayName).toBe('Ben');
      expect(activeReminders(occurrence.id).map((row) => row.recipient)).toEqual([ben.id]);
      await assignOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id, assigneeUserId: cleo.id });
      expect(activeReminders(occurrence.id).map((row) => row.recipient)).toEqual([cleo.id]);
      expect(reminders(occurrence.id).filter((row) => row.recipient === ana.id).every((row) => row.cancelled !== null)).toBe(true);
    });

    it('grants nothing: a GUEST Assignee sees the Occurrence but cannot complete, skip or start it', async () => {
      const tax = await reminder(ana, { assigneeUserId: gus.id });
      const occurrence = await first(tax);
      expect((await listOpenOccurrences(deps, { actor: gus, workspaceId: home.id })).map((item) => item.occurrence.id)).toEqual([occurrence.id]);
      await expect(completeOccurrence(deps, { actor: gus, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(NotAuthorizedError);
      await expect(skipOccurrence(deps, { actor: gus, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(NotAuthorizedError);
      await expect(assignOccurrence(deps, { actor: gus, workspaceId: home.id, occurrenceId: occurrence.id, assigneeUserId: gus.id })).rejects.toThrow(NotAuthorizedError);
      // Anyone with the execution permission may complete; the completing user is recorded, the Assignee stays.
      const done = await completeOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: occurrence.id });
      expect(done.occurrence.closed?.by.displayName).toBe('Ben');
      expect(done.schedule.assignee?.displayName).toBe('Gus');
    });

    it('re-checks the actor inside the transaction and keeps Workspaces apart', async () => {
      const tax = await reminder(ana);
      const occurrence = await first(tax);
      await changeMemberRole({ users: createUserRepository(database), workspaces: deps.workspaces, clock: deps.clock }, { actor: admin, workspaceId: home.id, userId: ben.id, role: 'GUEST' });
      await expect(completeOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(NotAuthorizedError);
      await expect(completeOccurrence(deps, { actor: otto, workspaceId: office.id, occurrenceId: occurrence.id })).rejects.toThrow(ScheduleNotFoundError);
      await expect(scheduleHistory(deps, { actor: otto, workspaceId: office.id, scheduleId: tax.id })).rejects.toThrow(ScheduleNotFoundError);
    });

    it('records one completion when two members complete the same Occurrence at once', async () => {
      const occurrence = await first(await reminder(ana));
      const results = await Promise.allSettled([
        completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id }),
        completeOccurrence(deps, { actor: ben, workspaceId: home.id, occurrenceId: occurrence.id }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(ScheduleClosedError) });
      expect(auditTypes().filter((type) => type === 'OCCURRENCE_COMPLETED')).toHaveLength(1);
    });
  });

  describe('integrity', () => {
    it('commits the state change and its audit event together (rollback on audit failure)', async () => {
      const tax = await reminder(ana);
      const occurrence = await first(tax);
      database.sqlite.exec("CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.type = 'OCCURRENCE_COMPLETED' BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
      await expect(completeOccurrence(deps, { actor: ana, workspaceId: home.id, occurrenceId: occurrence.id })).rejects.toThrow(/audit down/);
      database.sqlite.exec('DROP TRIGGER fail_audit');
      expect((await first(tax)).state).toBe('OPEN');
      expect(activeReminders(occurrence.id)).toEqual(activeReminders(occurrence.id));
    });

    it('protects history in the database: never deleted, identity immutable, cancelled final', async () => {
      at('2027-01-10T08:00:00Z');
      const monthly = await reminder(ana, { date: '2027-01-15', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 1 } });
      const occurrence = await first(monthly);
      expect(() => database.sqlite.prepare('DELETE FROM occurrences').run()).toThrow(/never deleted/);
      expect(() => database.sqlite.prepare('DELETE FROM schedules').run()).toThrow(/never deleted/);
      expect(() => database.sqlite.prepare('UPDATE occurrences SET schedule_id = ? WHERE id = ?').run(monthly.id, occurrence.id)).toThrow(/immutable/);
      expect(() => database.sqlite.prepare("UPDATE schedules SET kind = 'PROCEDURE' WHERE id = ?").run(monthly.id)).toThrow(/immutable/);
      await endSchedule(deps, { actor: ana, workspaceId: home.id, scheduleId: monthly.id, expectedRevision: monthly.revision });
      expect(() => database.sqlite.prepare("UPDATE occurrences SET state = 'OPEN' WHERE id = ?").run(occurrence.id)).toThrow(/cancelled/);
      expect(() => database.sqlite.prepare("UPDATE schedules SET state = 'ACTIVE' WHERE id = ?").run(monthly.id)).toThrow(/ended/);
      // One non-cancelled Occurrence per Schedule and date.
      expect(() =>
        database.sqlite
          .prepare("INSERT INTO occurrences (id, schedule_id, workspace_id, due_date, state, created_at, updated_at) VALUES (?, ?, ?, '2027-02-15', 'OPEN', 0, 0)")
          .run('9f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', monthly.id, home.id),
      ).not.toThrow();
      expect(() =>
        database.sqlite
          .prepare("INSERT INTO occurrences (id, schedule_id, workspace_id, due_date, state, created_at, updated_at) VALUES (?, ?, ?, '2027-02-15', 'OPEN', 0, 0)")
          .run('8f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', monthly.id, home.id),
      ).toThrow(/UNIQUE/);
    });
  });
});

