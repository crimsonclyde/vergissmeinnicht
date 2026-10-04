import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

it('preserves configured house flags and history on upgrade, enables old core tools, and leaves fresh Workspaces empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0036-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0036');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const user = await createUserRepository(database).create({ email: normalizeEmail('upgrade@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const old = insertLegacyWorkspace(database, { name: 'Old', adminUserId: user.id });
    database.sqlite.prepare("INSERT INTO workspace_tools VALUES (?, 'DOCUMENTS', 1, 1, ?), (?, 'CONTACTS', 0, 1, ?)").run(old.id, user.id, old.id, user.id);
    const flags = database.sqlite.prepare('SELECT * FROM workspace_tools ORDER BY tool').all();
    const history = database.sqlite.prepare('SELECT * FROM audit_events').all();
    database.close();
    runMigrations(path);
    database = openDatabase(path);
    expect(database.sqlite.prepare("SELECT * FROM workspace_tools WHERE tool IN ('DOCUMENTS', 'CONTACTS') ORDER BY tool").all()).toEqual(flags);
    expect(database.sqlite.prepare('SELECT * FROM audit_events').all()).toEqual(history);
    const repo = createWorkspaceRepository(database);
    expect(await repo.enabledTools(old.id)).toEqual(['CALENDAR', 'DOCUMENTS', 'LISTS', 'PROCEDURES', 'REMINDERS']);
    const fresh = await repo.create({ name: 'Fresh', creatorId: user.id, creatorRole: 'ADMIN', at: new Date() }, { kind: 'user', userId: user.id, displayName: user.displayName });
    expect(await repo.enabledTools(fresh.id)).toEqual([]);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM lists WHERE workspace_id = ?').get(fresh.id)).toEqual({ n: 0 });
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }); }
});
