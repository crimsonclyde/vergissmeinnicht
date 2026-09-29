import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DELIVERY_LEASE_MS,
  NotificationDeliveryError,
  RETRY_DELAYS_MS,
  addMember,
  cancelSchedule,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  dispatchDueReminders,
  removeMember,
  scheduleProcedure,
  type NotificationChannel,
  type ProcedureInput,
  type ReminderDeps,
  type ReminderMessage,
  type ReminderNotifier,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type ProcedureId, type ScheduledProcedure, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createReminderQueue } from './reminder-queue.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const PROCEDURE: ProcedureInput = { title: 'Buy groceries', description: '', icon: 'food', tags: [], sections: [{ title: 'Shop', description: '', steps: [{ ...STEP, title: 'Milk' }] }] };

/** A fake provider that records what it sent and can be told to fail. */
function fakeNotifier(channel: NotificationChannel) {
  const sent: { to: string; message: ReminderMessage }[] = [];
  let failure: NotificationDeliveryError | undefined;
  let enabled = true;
  let gate: Promise<void> | undefined;
  const notifier: ReminderNotifier = {
    channel,
    enabledFor: async () => enabled,
    async send(user, message) {
      if (gate !== undefined) await gate;
      if (failure !== undefined) throw failure;
      sent.push({ to: user.email, message });
    },
  };
  return {
    notifier,
    sent,
    failWith: (error: NotificationDeliveryError | undefined) => void (failure = error),
    setEnabled: (value: boolean) => void (enabled = value),
    hold: (promise: Promise<void> | undefined) => void (gate = promise),
  };
}

describe('reminder dispatch (13.5)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let scheduleDeps: ScheduleDeps;
  let deps: ReminderDeps;
  let email: ReturnType<typeof fakeNotifier>;
  let telegram: ReturnType<typeof fakeNotifier>;
  let admin: User;
  let uma: User;
  let home: Workspace;
  let groceries: ProcedureId;
  let item: ScheduledProcedure;
  const clock = { now: () => now };

  const dispatch = (overrides: Partial<ReminderDeps> = {}) => dispatchDueReminders({ ...deps, ...overrides });
  const deliveries = () =>
    database.sqlite.prepare('SELECT channel, status, attempts, error_code AS code FROM reminder_deliveries ORDER BY rowid').all() as {
      channel: string;
      status: string;
      attempts: number;
      code: string | null;
    }[];
  const unprocessed = () => (database.sqlite.prepare('SELECT count(*) AS n FROM scheduled_reminders WHERE processed_at IS NULL AND cancelled_at IS NULL').get() as { n: number }).n;

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-29T10:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    admin = await users.create({ email: normalizeEmail('admin@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    uma = await users.create({ email: normalizeEmail('uma@example.org'), displayName: 'Uma', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: uma.email, role: 'USER' });
    groceries = (await createProcedure({ workspaces, procedures: createProcedureRepository(database), clock }, { actor: admin, workspaceId: home.id, content: PROCEDURE })).procedure.id;
    scheduleDeps = { workspaces, schedules: createScheduleRepository(database), notificationPreferences: createNotificationPreferencesRepository(database), clock };
    item = await scheduleProcedure(scheduleDeps, {
      actor: uma,
      workspaceId: home.id,
      procedureId: groceries,
      date: '2026-10-15',
      timeZone: 'Europe/Berlin',
      reminders: [
        { unit: 'DAYS', amount: 1 },
        { unit: 'DAYS', amount: 0 },
      ],
    });
    email = fakeNotifier('EMAIL');
    telegram = fakeNotifier('TELEGRAM');
    deps = { queue: createReminderQueue(database), notifiers: [email.notifier, telegram.notifier], clock, publicOrigin: 'https://vmn.example.org' };
  });
  afterEach(() => database.dispose());

  it('sends nothing before the reminder time', async () => {
    expect(await dispatch()).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0 });
    expect(email.sent).toEqual([]);
  });

  it('sends each due reminder once per enabled channel, to the person who scheduled it', async () => {
    now = new Date('2026-10-14T07:00:30Z'); // 09:00:30 in Berlin, the day before
    expect(await dispatch()).toMatchObject({ sent: 2 });
    expect(email.sent).toEqual([
      {
        to: 'uma@example.org',
        message: {
          procedureTitle: 'Buy groceries',
          workspaceName: 'Home',
          date: '2026-10-15',
          time: null,
          timeZone: 'Europe/Berlin',
          reminderKey: 'DAYS:1',
          overdue: false,
          url: `https://vmn.example.org/w/${home.id}`,
        },
      },
    ]);
    expect(telegram.sent).toHaveLength(1);
    // Again, and after a "restart" (a new queue on the same database): nothing is sent twice.
    await dispatch();
    await dispatch({ queue: createReminderQueue(database) });
    expect(email.sent).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
    expect(deliveries()).toEqual([
      { channel: 'EMAIL', status: 'SENT', attempts: 1, code: null },
      { channel: 'TELEGRAM', status: 'SENT', attempts: 1, code: null },
    ]);
    // The next one on the day.
    now = new Date('2026-10-15T07:05:00Z');
    await dispatch();
    expect(email.sent.map((entry) => entry.message.reminderKey)).toEqual(['DAYS:1', 'DAYS:0']);
    expect(unprocessed()).toBe(0);
  });

  it('never sends twice when two dispatchers run at the same time', async () => {
    now = new Date('2026-10-14T07:01:00Z');
    let release: () => void = () => undefined;
    email.hold(new Promise<void>((resolve) => (release = resolve)));
    const first = dispatch();
    const second = dispatch();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([first, second]);
    expect(email.sent).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  it('treats a claim that was never finished (crash while sending) as interrupted only after the lease', async () => {
    now = new Date('2026-10-14T07:01:00Z');
    const reminderId = (database.sqlite.prepare("SELECT id FROM scheduled_reminders WHERE reminder_key = 'DAYS:1'").get() as { id: string }).id;
    // Another process claimed the email delivery and died before recording the outcome.
    expect(await deps.queue.claim(reminderId, 'EMAIL', now, DELIVERY_LEASE_MS)).toMatchObject({ status: 'claimed', attempt: 1 });
    await dispatch();
    expect(email.sent).toEqual([]);
    expect(telegram.sent).toHaveLength(1);
    now = new Date(now.getTime() + DELIVERY_LEASE_MS + 1000);
    await dispatch();
    expect(email.sent).toHaveLength(1);
    expect(deliveries().find((d) => d.channel === 'EMAIL')).toEqual({ channel: 'EMAIL', status: 'SENT', attempts: 2, code: null });
  });

  it('retries transient failures with growing delays, a bounded number of times', async () => {
    now = new Date('2026-10-14T07:01:00Z');
    email.failWith(new NotificationDeliveryError('email_failed', true));
    telegram.setEnabled(false);
    await dispatch();
    expect(deliveries()).toEqual([{ channel: 'EMAIL', status: 'RETRY', attempts: 1, code: 'email_failed' }]);
    // Not before the retry time.
    now = new Date(now.getTime() + RETRY_DELAYS_MS[0] - 1000);
    await dispatch();
    expect(deliveries()[0]?.attempts).toBe(1);
    for (const delay of RETRY_DELAYS_MS) {
      now = new Date(now.getTime() + delay + 1000);
      await dispatch();
    }
    expect(deliveries()).toEqual([{ channel: 'EMAIL', status: 'FAILED', attempts: 4, code: 'email_failed' }]);
    // Given up: never again, even when the provider works again.
    email.failWith(undefined);
    now = new Date(now.getTime() + 24 * 3_600_000);
    await dispatch();
    expect(email.sent.filter((entry) => entry.message.reminderKey === 'DAYS:1')).toEqual([]);
  });

  it('does not retry permanent failures, and a failure never changes the schedule or history', async () => {
    now = new Date('2026-10-14T07:01:00Z');
    telegram.failWith(new NotificationDeliveryError('telegram_blocked', false));
    const auditBefore = database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get();
    await dispatch();
    expect(deliveries()).toEqual([
      { channel: 'EMAIL', status: 'SENT', attempts: 1, code: null },
      { channel: 'TELEGRAM', status: 'FAILED', attempts: 1, code: 'telegram_blocked' },
    ]);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get()).toEqual(auditBefore);
    expect(database.sqlite.prepare('SELECT state, revision FROM scheduled_procedures').get()).toEqual({ state: 'SCHEDULED', revision: 1 });
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n).toBe(0);
  });

  it('sends nothing to someone who left the Workspace, was disabled, or for a deleted Procedure', async () => {
    now = new Date('2026-10-14T07:01:00Z');
    const users = createUserRepository(database);
    await removeMember({ users, workspaces: scheduleDeps.workspaces, clock }, { actor: admin, workspaceId: home.id, userId: uma.id });
    expect(await dispatch()).toMatchObject({ sent: 0, skipped: 1 });
    expect(email.sent).toEqual([]);

    await addMember({ users, workspaces: scheduleDeps.workspaces, clock }, { actor: admin, workspaceId: home.id, email: uma.email, role: 'USER' });
    await deleteProcedure({ workspaces: scheduleDeps.workspaces, procedures: createProcedureRepository(database), clock }, { actor: admin, workspaceId: home.id, procedureId: groceries });
    now = new Date('2026-10-15T07:01:00Z');
    expect(await dispatch()).toMatchObject({ sent: 0, skipped: 1 });
    expect(email.sent).toEqual([]);
  });

  it('sends nothing for cancelled items and only through channels the person keeps enabled', async () => {
    telegram.setEnabled(false);
    now = new Date('2026-10-14T07:01:00Z');
    await dispatch();
    expect([email.sent.length, telegram.sent.length]).toEqual([1, 0]);
    await cancelSchedule(scheduleDeps, { actor: uma, workspaceId: home.id, scheduleId: item.id, expectedRevision: 1 });
    now = new Date('2026-10-15T07:01:00Z');
    await dispatch();
    expect(email.sent).toHaveLength(1);
  });

  it('drops reminders that are more than a day late (e.g. the server was down)', async () => {
    now = new Date('2026-10-15T09:00:00Z'); // DAYS:1 is 26 h late, DAYS:0 two hours
    expect(await dispatch()).toMatchObject({ sent: 2, skipped: 2 });
    expect(email.sent.map((entry) => entry.message.reminderKey)).toEqual(['DAYS:0']);
  });
});
