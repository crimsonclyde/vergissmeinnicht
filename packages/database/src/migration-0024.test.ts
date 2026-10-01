import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchDueReminders, type OutgoingNotification } from '@vergissmeinnicht/application';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createReminderQueue } from './reminder-queue.ts';
import { insertLegacyProcedure, insertLegacyRun, insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';


describe('migration 0024: scheduled Procedures become Schedules and Occurrences (D14)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-0024-'));
    path = join(dir, 'db.sqlite');
    const before = join(dir, 'migrations');
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journal = JSON.parse(readFileSync(join(before, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.tag >= '0024')) rmSync(join(before, `${entry.tag}.sql`));
    journal.entries = journal.entries.filter((entry) => entry.tag < '0024');
    writeFileSync(join(before, 'meta', '_journal.json'), JSON.stringify(journal));
    const database = openDatabase(path);
    migrate(database.db, { migrationsFolder: before });
    database.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps every item, date, reminder setting, delivery and audit event, links started Runs and sends nothing twice', async () => {
    let database = openDatabase(path);
    const now = new Date('2026-10-14T08:00:00Z');
    const users = createUserRepository(database);
    const ada = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const home = insertLegacyWorkspace(database, { name: 'Home', adminUserId: ada.id });
    // Plain SQL: today's repositories name columns this old schema does not have yet.
    const leave = insertLegacyProcedure(database, { workspaceId: home.id, userId: ada.id, title: 'Leave the house', icon: 'home', steps: [{ title: 'Stove off' }] });
    const gone = insertLegacyProcedure(database, { workspaceId: home.id, userId: ada.id, title: 'Gone', steps: [{ title: 'Stove off' }], deleted: true });
    // Runs in plain SQL: today's repositories name columns this old schema does not have yet.
    const legacyRun = (state: 'ACTIVE' | 'COMPLETED' | 'ABORTED') => ({
      run: { id: insertLegacyRun(database, { workspaceId: home.id, procedureId: leave.id, user: { id: ada.id, displayName: 'Ada' }, state, at: now.getTime() }).runId },
    });
    const active = legacyRun('ACTIVE');
    const completed = legacyRun('COMPLETED');
    const aborted = legacyRun('ABORTED');

    // Legacy rows exactly as 13.4 wrote them.
    const item = database.sqlite.prepare(
      `INSERT INTO scheduled_procedures (id, workspace_id, procedure_id, date, time, time_zone, reminder_time, reminders, state, revision, created_by_user_id, created_by_display_name, created_at, updated_at, run_id, closed_at, closed_by_user_id, closed_by_display_name)
       VALUES (?, ?, ?, ?, ?, 'Europe/Berlin', '09:00', ?, ?, 2, ?, 'Ada', ?, ?, ?, ?, ?, ?)`,
    );
    const reminders = JSON.stringify([
      { unit: 'DAYS', amount: 1 },
      { unit: 'DAYS', amount: 0 },
    ]);
    const ids = { open: randomUUID(), active: randomUUID(), completed: randomUUID(), aborted: randomUUID(), cancelled: randomUUID(), gone: randomUUID() };
    const t = now.getTime();
    item.run(ids.open, home.id, leave.id, '2026-10-15', '18:00', reminders, 'SCHEDULED', ada.id, t, t, null, null, null, null);
    item.run(ids.active, home.id, leave.id, '2026-10-16', null, reminders, 'STARTED', ada.id, t, t, active.run.id, t, ada.id, 'Ada');
    item.run(ids.completed, home.id, leave.id, '2026-10-17', null, reminders, 'STARTED', ada.id, t, t, completed.run.id, t, ada.id, 'Ada');
    item.run(ids.aborted, home.id, leave.id, '2026-10-18', null, reminders, 'STARTED', ada.id, t, t, aborted.run.id, t, ada.id, 'Ada');
    item.run(ids.cancelled, home.id, leave.id, '2026-10-19', null, reminders, 'CANCELLED', ada.id, t, t, null, t, ada.id, 'Ada');
    item.run(ids.gone, home.id, gone.id, '2026-10-20', null, reminders, 'SCHEDULED', ada.id, t, t, null, null, null, null);
    const dayBefore = { id: randomUUID(), at: Date.parse('2026-10-14T07:00:00Z') };
    const onTheDay = { id: randomUUID(), at: Date.parse('2026-10-15T07:00:00Z') };
    const reminder = database.sqlite.prepare('INSERT INTO scheduled_reminders (id, schedule_id, reminder_key, remind_at, recipient_user_id, processed_at, next_attempt_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)');
    reminder.run(dayBefore.id, ids.open, 'DAYS:1', dayBefore.at, ada.id, dayBefore.at);
    reminder.run(onTheDay.id, ids.open, 'DAYS:0', onTheDay.at, ada.id, null);
    database.sqlite
      .prepare("INSERT INTO reminder_deliveries (id, reminder_id, channel, status, attempts, next_attempt_at, updated_at, sent_at, error_code) VALUES (?, ?, 'EMAIL', 'SENT', 1, NULL, ?, ?, NULL)")
      .run(randomUUID(), dayBefore.id, dayBefore.at, dayBefore.at);

    const rows = (sql: string) => database.sqlite.prepare(sql).all();
    const remindersBefore = rows('SELECT id, schedule_id AS occurrence_id, reminder_key, remind_at, recipient_user_id, processed_at, next_attempt_at, cancelled_at FROM scheduled_reminders ORDER BY id');
    const deliveriesBefore = rows('SELECT id, reminder_id, channel, status, attempts, next_attempt_at, updated_at, sent_at, error_code FROM reminder_deliveries ORDER BY id');
    const auditBefore = rows('SELECT * FROM audit_events ORDER BY rowid');
    database.close();

    runMigrations(path);
    database = openDatabase(path);
    try {
      // Same ids: the Schedule and its one Occurrence keep the item's id (audit subject "schedule" still matches).
      const schedules = rows('SELECT id, kind, procedure_id, recurrence_kind, anchor_date, time, reminders, state, ended_by_display_name FROM schedules ORDER BY anchor_date') as Record<string, unknown>[];
      expect(schedules.map((row) => [row.id, row.kind, row.recurrence_kind, row.anchor_date, row.state])).toEqual([
        [ids.open, 'PROCEDURE', 'ONCE', '2026-10-15', 'ACTIVE'],
        [ids.active, 'PROCEDURE', 'ONCE', '2026-10-16', 'ACTIVE'],
        [ids.completed, 'PROCEDURE', 'ONCE', '2026-10-17', 'ACTIVE'],
        [ids.aborted, 'PROCEDURE', 'ONCE', '2026-10-18', 'ACTIVE'],
        [ids.cancelled, 'PROCEDURE', 'ONCE', '2026-10-19', 'ENDED'],
        [ids.gone, 'PROCEDURE', 'ONCE', '2026-10-20', 'ACTIVE'],
      ]);
      expect(JSON.parse(String(schedules[0]?.reminders))).toEqual(JSON.parse(reminders));
      expect(schedules[0]?.time).toBe('18:00');
      expect(schedules[4]?.ended_by_display_name).toBe('Ada');
      const occurrences = rows('SELECT id, schedule_id, due_date, state, closed_by_display_name FROM occurrences ORDER BY due_date') as Record<string, unknown>[];
      expect(occurrences.map((row) => [row.id, row.schedule_id, row.due_date, row.state])).toEqual([
        [ids.open, ids.open, '2026-10-15', 'OPEN'],
        [ids.active, ids.active, '2026-10-16', 'IN_PROGRESS'],
        [ids.completed, ids.completed, '2026-10-17', 'COMPLETED'],
        [ids.aborted, ids.aborted, '2026-10-18', 'OPEN'],
        [ids.cancelled, ids.cancelled, '2026-10-19', 'CANCELLED'],
        [ids.gone, ids.gone, '2026-10-20', 'OPEN'],
      ]);
      expect(occurrences[2]?.closed_by_display_name).toBe('Ada');
      const links = rows('SELECT id, occurrence_id, run_id, how, end_reason FROM occurrence_runs ORDER BY occurrence_id') as Record<string, unknown>[];
      expect(links.map((row) => [row.occurrence_id, row.run_id, row.how, row.end_reason]).sort()).toEqual(
        [
          [ids.active, active.run.id, 'STARTED', null],
          [ids.completed, completed.run.id, 'STARTED', null],
          [ids.aborted, aborted.run.id, 'STARTED', 'ABORTED'],
        ].sort(),
      );
      expect(links.every((row) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(row.id)))).toBe(true);
      // Reminders and deliveries: every row kept, re-pointed to the Occurrence (same id as the item).
      expect(rows('SELECT id, occurrence_id, reminder_key, remind_at, recipient_user_id, processed_at, next_attempt_at, cancelled_at FROM scheduled_reminders ORDER BY id')).toEqual(remindersBefore);
      expect(rows('SELECT id, reminder_id, channel, status, attempts, next_attempt_at, updated_at, sent_at, error_code FROM reminder_deliveries ORDER BY id')).toEqual(deliveriesBefore);
      expect(rows('SELECT * FROM audit_events ORDER BY rowid')).toEqual(auditBefore);
      expect(rows("SELECT name FROM sqlite_master WHERE name = 'scheduled_procedures'")).toEqual([]);

      // The dispatcher right after the upgrade sends the pending reminder once — never the one already sent.
      const sent: OutgoingNotification[] = [];
      const deps = {
        queue: createReminderQueue(database),
        notifiers: [{ channel: 'EMAIL' as const, enabledFor: async () => true, send: async (_user: unknown, message: OutgoingNotification) => void sent.push(message) }],
        clock: { now: () => new Date('2026-10-15T07:00:00Z') },
        publicOrigin: 'https://vmn.example.org',
      };
      await dispatchDueReminders(deps);
      await dispatchDueReminders(deps);
      expect(sent.map((message) => message.subject)).toEqual(['Reminder: Leave the house — in 9 hours']);
    } finally {
      database.close();
    }
  });
});
