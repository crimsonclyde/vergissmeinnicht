import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { insertLegacyWorkspace } from './test-support.ts';

it('0058 preserves flags, personal settings and points, enables existing Workspaces only, and retains SQL guards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0058-')); const path = join(dir, 'db.sqlite'); const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter(entry => entry.tag < '0058'); writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const user = await createUserRepository(database).create({ email: normalizeEmail('upgrade58@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const home = insertLegacyWorkspace(database, { name: 'Existing', adminUserId: user.id });
    database.sqlite.prepare("INSERT INTO workspace_tools VALUES(?,'EQUIPMENT',0,123,?)").run(home.id, user.id);
    database.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,updated_at,navigation_order) VALUES(?,'dark','tap-confirm',123,'[\"EQUIPMENT\"]')").run(user.id);
    database.sqlite.prepare('INSERT INTO progress_awards VALUES(?,?,10,123)').run('a'.repeat(64), user.id);
    database.close(); runMigrations(path); database = openDatabase(path);
    expect(database.sqlite.prepare('SELECT tool,enabled FROM workspace_tools WHERE workspace_id=? ORDER BY tool').all(home.id)).toEqual([{ tool: 'EQUIPMENT', enabled: 0 }, { tool: 'GAMIFICATION', enabled: 1 }]);
    expect(database.sqlite.prepare('SELECT theme,critical_confirm,navigation_order,private_gamification FROM user_preferences').get()).toEqual({ theme: 'dark', critical_confirm: 'tap-confirm', navigation_order: '["EQUIPMENT"]', private_gamification: 1 });
    expect(database.sqlite.prepare('SELECT points FROM progress_awards').get()).toEqual({ points: 10 });
    const fresh = insertLegacyWorkspace(database, { name: 'New', adminUserId: user.id });
    expect(database.sqlite.prepare('SELECT count(*) n FROM workspace_tools WHERE workspace_id=?').get(fresh.id)).toEqual({ n: 0 });
    expect(() => database.sqlite.prepare("UPDATE user_preferences SET navigation_order='[\"MORE\"]'").run()).toThrow();
    expect(() => database.sqlite.prepare('UPDATE user_preferences SET private_gamification=2').run()).toThrow();
    expect(() => database.sqlite.prepare("UPDATE workspace_tools SET tool='ARBITRARY'").run()).toThrow();
    expect(() => database.sqlite.prepare('UPDATE progress_awards SET points=100').run()).toThrow();
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }); }
});
