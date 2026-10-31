import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { NAVIGATION_TOOLS, normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { insertLegacyWorkspace } from './test-support.ts';
it('0059 preserves populated flags/preferences/points and permits ten reviewed navigation tools with guards intact', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'vmn-0059-')); const path = join(dir, 'db.sqlite'); const before = join(dir, 'migrations');
 cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
 const journalPath = join(before, 'meta/_journal.json'); const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
 journal.entries = journal.entries.filter(entry => entry.tag < '0059'); writeFileSync(journalPath, JSON.stringify(journal));
 let db = openDatabase(path);
 try {
  migrate(db.db, { migrationsFolder: before });
  const user = await createUserRepository(db).create({ email: normalizeEmail('upgrade59@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
  const workspace = insertLegacyWorkspace(db, { name: 'Existing', adminUserId: user.id });
  db.sqlite.prepare("INSERT INTO workspace_tools VALUES(?,'JOURNAL',1,123,?)").run(workspace.id, user.id);
  db.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at) VALUES(?,'dark','tap-confirm',0,'[\"EQUIPMENT\"]',123)").run(user.id);
  db.sqlite.prepare('INSERT INTO progress_awards VALUES(?,?,10,123)').run('a'.repeat(64), user.id);
  const flags = db.sqlite.prepare('SELECT * FROM workspace_tools').all();
  const prefs = db.sqlite.prepare('SELECT user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at FROM user_preferences').all();
  db.close(); runMigrations(path); db = openDatabase(path);
  expect(db.sqlite.prepare('SELECT * FROM workspace_tools').all()).toEqual(flags);
  expect(db.sqlite.prepare('SELECT user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at FROM user_preferences').all()).toEqual(prefs);
  expect(db.sqlite.prepare('SELECT points FROM progress_awards').get()).toEqual({ points: 10 });
  expect(db.sqlite.prepare("SELECT count(*) n FROM workspace_tools WHERE tool='BRING'").get()).toEqual({ n: 0 });
  db.sqlite.prepare('UPDATE user_preferences SET navigation_order=?').run(JSON.stringify(NAVIGATION_TOOLS));
  for (const order of [['MORE'], ['BRING', 'BRING'], ['UNKNOWN']]) expect(() => db.sqlite.prepare('UPDATE user_preferences SET navigation_order=?').run(JSON.stringify(order))).toThrow();
  expect(() => db.sqlite.prepare('UPDATE user_preferences SET private_gamification=2').run()).toThrow();
  expect(() => db.sqlite.prepare("UPDATE workspace_tools SET tool='UNKNOWN'").run()).toThrow();
  expect(() => db.sqlite.prepare('UPDATE progress_awards SET points=99').run()).toThrow();
  expect(db.sqlite.pragma('foreign_key_check')).toEqual([]); expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
