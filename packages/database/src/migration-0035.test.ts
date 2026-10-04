import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { normalizeEmail } from '@vergissmeinnicht/domain';

it('0035 preserves existing flags and history and starts tool settings at revision zero', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0035-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journal = JSON.parse(readFileSync(join(before, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0035');
  writeFileSync(join(before, 'meta', '_journal.json'), JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const actor = await createUserRepository(database).create({ email: normalizeEmail('upgrade@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const home = insertLegacyWorkspace(database, { name: 'Home', adminUserId: actor.id });
    const insert = database.sqlite.prepare('INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?, ?)');
    insert.run(home.id, 'DOCUMENTS', 1, 1, actor.id);
    insert.run(home.id, 'CONTACTS', 0, 1, actor.id);
    const flags = database.sqlite.prepare("SELECT * FROM workspace_tools WHERE tool IN ('DOCUMENTS', 'CONTACTS', 'MAINTENANCE') ORDER BY tool").all();
    const history = database.sqlite.prepare('SELECT * FROM audit_events').all();
    database.close();
    runMigrations(path);
    database = openDatabase(path);
    expect(database.sqlite.prepare("SELECT * FROM workspace_tools WHERE tool IN ('DOCUMENTS', 'CONTACTS', 'MAINTENANCE') ORDER BY tool").all()).toEqual(flags);
    expect(database.sqlite.prepare('SELECT * FROM audit_events').all()).toEqual(history);
    expect(database.sqlite.prepare('SELECT tools_revision FROM workspaces WHERE id = ?').get(home.id)).toEqual({ tools_revision: 0 });
    const fresh = insertLegacyWorkspace(database, { name: 'New Home', adminUserId: actor.id });
    expect(database.sqlite.prepare('SELECT tools_revision FROM workspaces WHERE id = ?').get(fresh.id)).toEqual({ tools_revision: 0 });
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
