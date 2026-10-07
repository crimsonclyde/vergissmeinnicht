import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

it('0040 upgrades a beta.7 database: Lists and items unchanged, change stamps filled from what each row says', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0040-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0040');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const users = createUserRepository(database);
    const ada = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const bea = await users.create({ email: normalizeEmail('bea@example.org'), displayName: 'Bea', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const workspace = insertLegacyWorkspace(database, { name: 'Home', adminUserId: ada.id });
    const list = randomUUID();
    const [milk, bread, gone] = [randomUUID(), randomUUID(), randomUUID()];
    database.sqlite
      .prepare("INSERT INTO lists (id, workspace_id, kind, title, revision, created_by_user_id, created_by_display_name, created_at, updated_at) VALUES (?, ?, 'GROCERY', 'Groceries', 5, ?, 'Ada', 1000, 5000)")
      .run(list, workspace.id, ada.id);
    const item = database.sqlite.prepare(
      'INSERT INTO list_items (id, list_id, workspace_id, position, title, quantity, unit, revision, created_by_user_id, created_by_display_name, created_at, checked_at, checked_by_user_id, checked_by_display_name, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)',
    );
    item.run(milk, list, workspace.id, 0, 'Milk', '2', 'l', ada.id, 'Ada', 2000, 4000, bea.id, 'Bea', null);
    item.run(bread, list, workspace.id, 1, 'Bread', null, null, bea.id, 'Bea', 3000, null, null, null, null);
    item.run(gone, list, workspace.id, 2, 'Eggs', null, null, ada.id, 'Ada', 3500, null, null, null, 4500);
    const listsBefore = database.sqlite.prepare('SELECT * FROM lists').all();
    const itemsBefore = database.sqlite.prepare('SELECT * FROM list_items ORDER BY position').all();
    const history = database.sqlite.prepare('SELECT * FROM audit_events').all();
    database.close();
    runMigrations(path);
    database = openDatabase(path);
    const lists = database.sqlite.prepare('SELECT * FROM lists').all() as Record<string, unknown>[];
    expect(lists).toEqual(listsBefore.map((row) => ({ ...(row as object), title_changed_at: 1000, title_changed_by_display_name: 'Ada' })));
    const items = database.sqlite.prepare('SELECT * FROM list_items ORDER BY position').all() as Record<string, unknown>[];
    expect(items).toEqual([
      { ...(itemsBefore[0] as object), deleted_by_display_name: null, content_changed_at: 2000, content_changed_by_display_name: 'Ada', check_changed_at: 4000, check_changed_by_display_name: 'Bea' },
      { ...(itemsBefore[1] as object), deleted_by_display_name: null, content_changed_at: 3000, content_changed_by_display_name: 'Bea', check_changed_at: 3000, check_changed_by_display_name: 'Bea' },
      { ...(itemsBefore[2] as object), deleted_by_display_name: null, content_changed_at: 3500, content_changed_by_display_name: 'Ada', check_changed_at: 3500, check_changed_by_display_name: 'Ada' },
    ]);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM list_client_changes').get()).toEqual({ n: 0 });
    expect(database.sqlite.prepare('SELECT * FROM audit_events').all()).toEqual(history);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
