import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DELIVERY_LEASE_MS,
  NotificationDeliveryError,
  RETRY_DELAYS_MS,
  addMember,
  completeOccurrence,
  createProcedure,
  createSchedule,
  createWorkspace,
  deleteProcedure,
  dispatchDueReminders,
  listOpenOccurrences,
  pauseSchedule,
  removeMember,
  updateSchedule,
  type NotificationChannel,
  type OutgoingNotification,
  type ProcedureInput,
  type ReminderDeps,
  type ReminderNotifier,
  type ReminderQueue,
  setWorkspaceTool,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type Schedule, type User, type Workspace } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createWorkspaceToolRepository } from './document-repository.ts';
import { createReminderQueue } from './reminder-queue.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const PROCEDURE: ProcedureInput = { title: 'Buy groceries', description: '', icon: 'food', tags: [], sections: [{ title: 'Shop', description: '', steps: [{ ...STEP, title: 'Milk' }] }] };
const BERLIN = 'Europe/Berlin';

/** A fake provider that records every call (even ones that "crash" afterwards) and can be told to fail. */
function fakeNotifier(channel: NotificationChannel) {
  const sent: { to: string; message: OutgoingNotification }[] = [];
  let failures: NotificationDeliveryError[] = [];
  let enabled = true;
  let gate: Promise<void> | undefined;
  const notifier: ReminderNotifier = {
    channel,
    enabledFor: async () => enabled,
    async send(user, message) {
      if (gate !== undefined) await gate;
      const failure = failures.shift();
      if (failure !== undefined) throw failure;
      sent.push({ to: user.email, message });
    },
  };
  return {
    notifier,
    sent,
    failWith: (...errors: NotificationDeliveryError[]) => void (failures = errors),
    setEnabled: (value: boolean) => void (enabled = value),
    hold: (promise: Promise<void> | undefined) => void (gate = promise),
  };
}

describe('reminder dispatch (13.5, 14.1)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let scheduleDeps: ScheduleDeps;
  let deps: ReminderDeps;
  let email: ReturnType<typeof fakeNotifier>;
  let telegram: ReturnType<typeof fakeNotifier>;
  let admin: User;
  let ana: User;
  let ben: User;
  let home: Workspace;
  const clock = { now: () => now };
  const at = (iso: string) => {
    now = new Date(iso);
  };

  const dispatch = (overrides: Partial<ReminderDeps> = {}) => dispatchDueReminders({ ...deps, ...overrides });
  const deliveries = () =>
    database.sqlite.prepare('SELECT channel, status, attempts, error_code AS code FROM reminder_deliveries ORDER BY rowid').all() as { channel: string; status: string; attempts: number; code: string | null }[];
  const unprocessed = () => (database.sqlite.prepare('SELECT count(*) AS n FROM scheduled_reminders WHERE processed_at IS NULL AND cancelled_at IS NULL').get() as { n: number }).n;
  const superseded = () => (database.sqlite.prepare('SELECT count(*) AS n FROM scheduled_reminders WHERE superseded_at IS NOT NULL').get() as { n: number }).n;
  const summaries = () => database.sqlite.prepare('SELECT channel, status, attempts FROM notification_summaries ORDER BY rowid').all() as { channel: string; status: string; attempts: number }[];
  const reminder = (overrides: Partial<Parameters<typeof createSchedule>[1]> = {}) =>
    createSchedule(scheduleDeps, { actor: ana, workspaceId: home.id, title: 'Pay annual tax', date: '2027-06-15', timeZone: BERLIN, reminders: [{ unit: 'MONTHS', amount: 1 }, { unit: 'WEEKS', amount: 1 }], ...overrides });
  const openOccurrence = async (schedule: Schedule) => {
    const item = (await listOpenOccurrences(scheduleDeps, { actor: admin, workspaceId: home.id })).find((entry) => entry.schedule.id === schedule.id);
    if (item === undefined) throw new Error('no open occurrence');
    return item.occurrence;
  };

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2027-04-01T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const user = (mail: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(mail), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    ana = await user('ana@example.org', 'Ana');
    ben = await user('ben@example.org', 'Ben');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: ana.email, role: 'USER' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: ben.email, role: 'USER' });
    scheduleDeps = { workspaces, schedules: createScheduleRepository(database), notificationPreferences: createNotificationPreferencesRepository(database), clock };
    email = fakeNotifier('EMAIL');
    telegram = fakeNotifier('TELEGRAM');
    deps = { queue: createReminderQueue(database), notifiers: [email.notifier, telegram.notifier], clock, publicOrigin: 'https://vmn.example.org' };
  });
  afterEach(() => database.dispose());

  describe('normal delivery', () => {
    it('pauses disabled source deliveries, rechecks after provider eligibility, and Calendar never stops delivery', async () => {
      await reminder();
      at('2027-05-15T07:00:00Z');
      const tools = createWorkspaceToolRepository(database);
      const switchTool = (tool: string, enabled: boolean) => setWorkspaceTool({ workspaces: scheduleDeps.workspaces, tools, clock }, { actor: admin, workspaceId: home.id, tool, enabled });
      await switchTool('REMINDERS', false);
      expect(await dispatch()).toMatchObject({ sent: 0 });
      expect(deliveries()).toEqual([]);
      const pending = unprocessed();
      await switchTool('REMINDERS', true);
      const disableDuringEligibility = { ...email.notifier, enabledFor: async () => { await switchTool('REMINDERS', false); return true; } };
      expect(await dispatch({ notifiers: [disableDuringEligibility] })).toMatchObject({ sent: 0 });
      expect(email.sent).toEqual([]);
      expect(unprocessed()).toBe(pending);
      await switchTool('REMINDERS', true);
      await switchTool('CALENDAR', false);
      expect(await dispatch()).toMatchObject({ sent: 2 });
      expect(await dispatch()).toMatchObject({ sent: 0 });
    });

    it('reenable catches up recent notifications and drops older ones without changing Occurrences', async () => {
      await reminder({ title: 'Old notification', date: '2027-05-14', reminders: [{ unit: 'DAYS', amount: 0 }] });
      await reminder({ title: 'Recent notification', date: '2027-05-15', reminders: [{ unit: 'DAYS', amount: 0 }] });
      const tools = createWorkspaceToolRepository(database);
      const switchTool = (enabled: boolean) => setWorkspaceTool({ workspaces: scheduleDeps.workspaces, tools, clock }, { actor: admin, workspaceId: home.id, tool: 'REMINDERS', enabled });
      await switchTool(false);
      at('2027-05-15T12:00:00Z');
      expect(await dispatch()).toMatchObject({ sent: 0 });
      const before = database.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all();
      await switchTool(true);
      expect(await dispatch()).toMatchObject({ sent: 2, summaries: 0 });
      expect(email.sent[0]?.message.body).toContain('Recent notification');
      expect(email.sent[0]?.message.body).not.toContain('Old notification');
      expect(superseded()).toBe(1);
      expect(database.sqlite.prepare('SELECT * FROM occurrences ORDER BY id').all()).toEqual(before);
      expect(await dispatch()).toMatchObject({ sent: 0 });
    });

    it('sends each reminder once per channel at its time, with the current status and a stable key', async () => {
      await reminder();
      expect(await dispatch()).toMatchObject({ sent: 0 });
      at('2027-05-15T07:00:00Z'); // 1 month before, 09:00 Berlin
      expect(await dispatch()).toMatchObject({ sent: 2, summaries: 0 });
      const [first] = email.sent;
      expect(first?.message.subject).toBe('Reminder: Pay annual tax — in 31 days');
      expect(first?.message.body).toContain('to mark it done');
      expect(first?.message.key).toMatch(/^r-[0-9a-f-]{36}-email$/);
      // A restart (a fresh queue on the same database) sends nothing again.
      expect(await dispatch({ queue: createReminderQueue(database) })).toMatchObject({ sent: 0 });
      expect(email.sent).toHaveLength(1);
      expect(telegram.sent).toHaveLength(1);
      expect(unprocessed()).toBe(1); // the 1-week reminder is still ahead
    });

    it('lets concurrent workers on separate connections call the provider once per logical notification', async () => {
      for (let i = 0; i < 5; i++) await reminder({ title: `Bill ${i}`, reminders: [{ unit: 'DAYS', amount: 0 }] });
      at('2027-06-15T07:00:00Z');
      const second = openDatabase(database.path);
      try {
        let release: () => void = () => undefined;
        email.hold(new Promise<void>((resolve) => (release = resolve)));
        const running = Promise.all([dispatch(), dispatch({ queue: createReminderQueue(second) })]);
        release();
        await running;
        expect(email.sent).toHaveLength(5);
        expect(telegram.sent).toHaveLength(5);
        expect(new Set(email.sent.map((entry) => entry.message.key)).size).toBe(5);
      } finally {
        second.close();
      }
    });

    it('retries a claim interrupted before the provider call once after the lease, and records success so a restart sends nothing', async () => {
      await reminder({ reminders: [{ unit: 'DAYS', amount: 0 }] });
      at('2027-06-15T07:00:00Z');
      // A worker claimed both channels and died before calling the provider.
      const queue = createReminderQueue(database);
      const [due] = await queue.due(now, 10);
      await queue.claim(due?.reminderId ?? '', 'EMAIL', now, DELIVERY_LEASE_MS);
      await queue.claim(due?.reminderId ?? '', 'TELEGRAM', now, DELIVERY_LEASE_MS);
      expect(await dispatch()).toMatchObject({ sent: 0 }); // lease still held
      at(new Date(now.getTime() + DELIVERY_LEASE_MS + 1000).toISOString());
      expect(await dispatch()).toMatchObject({ sent: 2 });
      expect(deliveries().map((row) => [row.status, row.attempts])).toEqual([
        ['SENT', 2],
        ['SENT', 2],
      ]);
      expect(await dispatch({ queue: createReminderQueue(database) })).toMatchObject({ sent: 0 });
      expect(email.sent).toHaveLength(1);
    });

    it('may repeat one message at most once when a crash hits after the provider accepted it (documented limit)', async () => {
      await reminder({ reminders: [{ unit: 'DAYS', amount: 0 }] });
      at('2027-06-15T07:00:00Z');
      const real = createReminderQueue(database);
      let crash = true;
      const crashing: ReminderQueue = {
        ...real,
        sent: async (id, when) => {
          if (crash) throw new Error('process died');
          return real.sent(id, when);
        },
      };
      await expect(dispatch({ queue: crashing, notifiers: [email.notifier] })).rejects.toThrow('process died');
      crash = false;
      at(new Date(now.getTime() + DELIVERY_LEASE_MS + 1000).toISOString());
      await dispatch({ notifiers: [email.notifier] });
      await dispatch({ notifiers: [email.notifier] });
      expect(email.sent).toHaveLength(2); // the accepted one and exactly one repeat — never more
      expect(email.sent[0]?.message.key).toBe(email.sent[1]?.message.key); // same Message-ID key
    });

    it('retries transient failures after 1 min, 10 min and 1 h, then gives up', async () => {
      await reminder({ reminders: [{ unit: 'DAYS', amount: 0 }] });
      at('2027-06-15T07:00:00Z');
      const transient = new NotificationDeliveryError('email_failed', true);
      email.failWith(transient, transient, transient, transient);
      await dispatch({ notifiers: [email.notifier] });
      for (const delay of RETRY_DELAYS_MS) {
        at(new Date(now.getTime() + delay).toISOString());
        await dispatch({ notifiers: [email.notifier] });
      }
      expect(deliveries()).toEqual([{ channel: 'EMAIL', status: 'FAILED', attempts: 4, code: 'email_failed' }]);
      expect(unprocessed()).toBe(0);
    });

    it('re-checks the recipient, the Occurrence and the Schedule at send time', async () => {
      const removed = await reminder({ title: 'Removed', reminders: [{ unit: 'DAYS', amount: 0 }] });
      const completed = await reminder({ title: 'Completed', reminders: [{ unit: 'DAYS', amount: 0 }] });
      const paused = await reminder({ title: 'Paused', reminders: [{ unit: 'DAYS', amount: 0 }] });
      const procedure = await createProcedure(
        { workspaces: scheduleDeps.workspaces, procedures: createProcedureRepository(database), clock },
        { actor: admin, workspaceId: home.id, content: PROCEDURE },
      );
      await createSchedule(scheduleDeps, { actor: ana, workspaceId: home.id, procedureId: procedure.procedure.id, date: '2027-06-15', timeZone: BERLIN, reminders: [{ unit: 'DAYS', amount: 0 }] });
      await completeOccurrence(scheduleDeps, { actor: ben, workspaceId: home.id, occurrenceId: (await openOccurrence(completed)).id });
      await pauseSchedule(scheduleDeps, { actor: ana, workspaceId: home.id, scheduleId: paused.id, expectedRevision: paused.revision });
      await deleteProcedure({ workspaces: scheduleDeps.workspaces, procedures: createProcedureRepository(database), clock }, { actor: admin, workspaceId: home.id, procedureId: procedure.procedure.id });
      const toBen = await updateSchedule(scheduleDeps, { actor: ana, workspaceId: home.id, scheduleId: removed.id, expectedRevision: removed.revision, date: '2027-06-15', timeZone: BERLIN, reminders: removed.reminders, assigneeUserId: ben.id });
      await removeMember({ users: createUserRepository(database), workspaces: scheduleDeps.workspaces, clock }, { actor: admin, workspaceId: home.id, userId: ben.id });
      at('2027-06-15T07:00:00Z');
      await dispatch();
      expect(email.sent).toEqual([]);
      expect(toBen.assignee?.displayName).toBe('Ben');
    });
  });

  describe('outage catch-up (D5)', () => {
    it('(a) sends one catch-up with the current due status and keeps the later offset', async () => {
      await reminder();
      at('2027-05-17T08:00:00Z'); // down 14–17 May: the 15 May reminder is 2 days late
      expect(await dispatch()).toMatchObject({ sent: 0, summaries: 2 });
      expect(email.sent.map((entry) => entry.message.subject)).toEqual(['Missed reminder: Pay annual tax — in 29 days']);
      expect(email.sent[0]?.message.body).toContain('due on Tuesday, 15 June 2027 (Europe/Berlin), in 29 days');
      expect(email.sent[0]?.message.body).not.toContain('1 month');
      expect(telegram.sent).toHaveLength(1);
      at('2027-06-08T07:00:00Z'); // the 1-week reminder arrives normally
      expect(await dispatch()).toMatchObject({ sent: 2, summaries: 0 });
      expect(email.sent.at(-1)?.message.subject).toBe('Reminder: Pay annual tax — in 7 days');
    });

    it('(b) covers earlier missed offsets with the most recent one', async () => {
      await reminder();
      at('2027-06-10T08:00:00Z'); // both 15 May and 8 June were missed
      expect(await dispatch()).toMatchObject({ summaries: 2, superseded: 1 });
      expect(email.sent).toHaveLength(1);
      expect(superseded()).toBe(1);
      expect(unprocessed()).toBe(0);
    });

    it('(c) delivers a reminder up to 24 h late normally', async () => {
      await reminder();
      at('2027-05-16T03:00:00Z'); // 20 hours late
      expect(await dispatch()).toMatchObject({ sent: 2, summaries: 0 });
      expect(email.sent[0]?.message.subject).toMatch(/^Reminder: /);
    });

    it('(d) sends nothing for Occurrences completed or paused during the outage', async () => {
      const done = await reminder({ title: 'Done' });
      const paused = await reminder({ title: 'Paused' });
      at('2027-05-16T08:00:00Z');
      await completeOccurrence(scheduleDeps, { actor: ben, workspaceId: home.id, occurrenceId: (await openOccurrence(done)).id });
      await pauseSchedule(scheduleDeps, { actor: ana, workspaceId: home.id, scheduleId: paused.id, expectedRevision: paused.revision });
      at('2027-05-18T08:00:00Z');
      await dispatch();
      expect(email.sent).toEqual([]);
      expect(summaries()).toEqual([]);
    });

    it('(e) sends no catch-up when a normal reminder for the same Occurrence comes within 24 h', async () => {
      await reminder({ date: '2027-06-15', reminders: [{ unit: 'WEEKS', amount: 1 }, { unit: 'DAYS', amount: 1 }] });
      at('2027-06-13T12:00:00Z'); // 1 week before (8 June) missed; 1 day before (14 June 09:00) is 19 h away
      expect(await dispatch()).toMatchObject({ summaries: 0, superseded: 1 });
      expect(email.sent).toEqual([]);
      at('2027-06-14T07:00:00Z');
      expect(await dispatch()).toMatchObject({ sent: 2 });
      expect(email.sent.map((entry) => entry.message.subject)).toEqual(['Reminder: Pay annual tax — tomorrow']);
    });

    it('(f) groups 30 missed Occurrences into one bounded summary per channel', async () => {
      for (let i = 0; i < 30; i++) await reminder({ title: `Bill ${String(i).padStart(2, '0')}`, date: '2027-06-15', reminders: [{ unit: 'MONTHS', amount: 1 }] });
      at('2027-05-20T08:00:00Z');
      expect(await dispatch()).toMatchObject({ summaries: 2 });
      expect(email.sent).toHaveLength(1);
      expect(telegram.sent).toHaveLength(1);
      const body = email.sent[0]?.message.body ?? '';
      expect(email.sent[0]?.message.subject).toBe('Missed reminders: 30 items need attention');
      expect(body.split('\n').filter((line) => line.startsWith('- Bill'))).toHaveLength(10);
      expect(body).toContain('- … and 20 more');
      expect(email.sent[0]?.message.key).toMatch(/^s-[0-9a-f-]{36}-email$/);
    });

    it('(g) never puts an Occurrence into two summaries, also across restarts and summary retries', async () => {
      for (let i = 0; i < 3; i++) await reminder({ title: `Bill ${i}`, reminders: [{ unit: 'MONTHS', amount: 1 }] });
      at('2027-05-20T08:00:00Z');
      email.failWith(new NotificationDeliveryError('email_failed', true));
      await dispatch();
      expect(summaries().map((row) => [row.channel, row.status])).toEqual([
        ['EMAIL', 'RETRY'],
        ['TELEGRAM', 'SENT'],
      ]);
      await dispatch({ queue: createReminderQueue(database) }); // restart before the retry is due
      at(new Date(now.getTime() + RETRY_DELAYS_MS[0] + 1000).toISOString());
      await dispatch({ queue: createReminderQueue(database) });
      await dispatch({ queue: createReminderQueue(database) });
      expect(summaries().map((row) => [row.channel, row.status, row.attempts])).toEqual([
        ['EMAIL', 'SENT', 2],
        ['TELEGRAM', 'SENT', 1],
      ]);
      expect(email.sent).toHaveLength(1);
      expect(telegram.sent).toHaveLength(1);
      expect(unprocessed()).toBe(0);
      expect(deliveries().every((row) => row.status === 'SENT')).toBe(true);
    });

    it('omits a disabled source from a mixed summary without stopping enabled Procedure notifications', async () => {
      await reminder({ title: 'Hidden tax', reminders: [{ unit: 'MONTHS', amount: 1 }] });
      const procedure = await createProcedure({ ...scheduleDeps, procedures: createProcedureRepository(database) }, { actor: admin, workspaceId: home.id, content: PROCEDURE });
      await reminder({ title: 'Visible groceries', procedureId: procedure.procedure.id, reminders: [{ unit: 'MONTHS', amount: 1 }] });
      at('2027-05-20T08:00:00Z');
      email.failWith(new NotificationDeliveryError('email_failed', true));
      await dispatch({ notifiers: [email.notifier] });
      await setWorkspaceTool({ workspaces: scheduleDeps.workspaces, tools: createWorkspaceToolRepository(database), clock }, { actor: admin, workspaceId: home.id, tool: 'REMINDERS', enabled: false });
      at(new Date(now.getTime() + RETRY_DELAYS_MS[0] + 1000).toISOString());
      await dispatch({ notifiers: [email.notifier] });
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]?.message.body).toContain('Buy groceries');
      expect(email.sent[0]?.message.body).not.toContain('Hidden tax');
      expect(email.sent[0]?.message.subject).not.toContain('2 items');
      expect(summaries()[0]?.status).toBe('SENT');
    });

    it('drops members that became ineligible before a summary retry', async () => {
      const kept = await reminder({ title: 'Kept', reminders: [{ unit: 'MONTHS', amount: 1 }] });
      const done = await reminder({ title: 'Done meanwhile', reminders: [{ unit: 'MONTHS', amount: 1 }] });
      at('2027-05-20T08:00:00Z');
      email.failWith(new NotificationDeliveryError('email_failed', true));
      await dispatch({ notifiers: [email.notifier] });
      await completeOccurrence(scheduleDeps, { actor: ana, workspaceId: home.id, occurrenceId: (await openOccurrence(done)).id });
      at(new Date(now.getTime() + RETRY_DELAYS_MS[0] + 1000).toISOString());
      await dispatch({ notifiers: [email.notifier] });
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]?.message.subject).toBe('Missed reminder: Kept — in 26 days');
      expect(kept.title).toBe('Kept');
    });
  });
});
