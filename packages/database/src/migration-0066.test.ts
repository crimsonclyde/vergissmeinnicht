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

it('0066 turns the global weather switch into one opt-in per Workspace the person belongs to', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0066-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0066');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const users = createUserRepository(database);
    const admin = await users.create({ email: normalizeEmail('admin@example.org'), displayName: 'Admin', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const guest = await users.create({ email: normalizeEmail('guest@example.org'), displayName: 'Guest', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const home = insertLegacyWorkspace(database, { name: 'Home', adminUserId: admin.id });
    const van = insertLegacyWorkspace(database, { name: 'Van', adminUserId: admin.id });
    database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'GUEST', 1, 1)").run(home.id, guest.id);
    database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'GUEST', 1, 1)").run(van.id, guest.id);
    const setting = database.sqlite.prepare("INSERT INTO user_weather_settings (user_id, use_workspace_location, provider, model, fallback, unit, show_tomorrow, updated_at) VALUES (?, ?, 'AUTO', 'best_match', 0, 'C', 1, 1)");
    setting.run(guest.id, 1);
    setting.run(admin.id, 0);
    database.close();

    runMigrations(path);
    database = openDatabase(path);
    // Existing consent is kept for every Workspace the person belongs to — and for no other.
    expect(database.sqlite.prepare('SELECT user_id, workspace_id FROM user_weather_workspace_locations ORDER BY workspace_id').all()).toEqual(
      [home.id, van.id].sort().map((workspaceId) => ({ user_id: guest.id, workspace_id: workspaceId })),
    );
    expect(database.sqlite.prepare("SELECT name FROM pragma_table_info('user_weather_settings') WHERE name = 'use_workspace_location'").all()).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
