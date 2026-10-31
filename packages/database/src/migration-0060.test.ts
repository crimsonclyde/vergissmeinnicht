import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES, normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { insertLegacyWorkspace } from './test-support.ts';

it('0060 preserves populated personal settings and Workspace data; adds bounded Guide defaults with old guards intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-guide-upgrade-')); const path = join(dir, 'db.sqlite'); const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const jp = join(before, 'meta/_journal.json'); const journal = JSON.parse(readFileSync(jp, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter(entry => entry.tag < '0060'); writeFileSync(jp, JSON.stringify(journal));
  let db = openDatabase(path);
  try {
    migrate(db.db, { migrationsFolder: before });
    const user = await createUserRepository(db).create({ email: normalizeEmail('upgrade60@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const workspace = insertLegacyWorkspace(db, { name: 'Preserved', adminUserId: user.id });
    db.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at) VALUES(?,'dark','tap-confirm',0,'[\"BRING\",\"EQUIPMENT\"]',123)").run(user.id);
    db.sqlite.prepare("INSERT INTO user_workspace_preferences VALUES(?,?,'witch-forest',1,456)").run(user.id, workspace.id);
    db.sqlite.prepare("INSERT INTO user_place_preferences VALUES(?,?,?,789)").run(user.id, workspace.id, '{"cardOpacity":35}');
    const shared = db.sqlite.prepare('SELECT * FROM workspaces').all();
    const perWorkspace = db.sqlite.prepare('SELECT * FROM user_workspace_preferences').all();
    db.close(); runMigrations(path); db = openDatabase(path);
    expect(db.sqlite.prepare('SELECT * FROM user_preferences').get()).toEqual({ user_id: user.id, theme: 'dark', critical_confirm: 'tap-confirm', private_gamification: 0, navigation_order: '["BRING","EQUIPMENT"]', updated_at: 123, guide: JSON.stringify(DEFAULT_GUIDE_PREFERENCES) });
    expect(db.sqlite.prepare('SELECT * FROM workspaces').all()).toEqual(shared);
    expect(db.sqlite.prepare('SELECT * FROM user_workspace_preferences').all()).toEqual(perWorkspace);
    expect(db.sqlite.prepare('SELECT settings FROM user_place_preferences').get()).toEqual({ settings: '{"cardOpacity":35}' });
    db.sqlite.prepare("UPDATE user_preferences SET theme='space-guide'").run();
    db.sqlite.prepare("UPDATE user_workspace_preferences SET theme='space-guide'").run();
    for (const navigation of ['["MORE"]','["BRING","BRING"]','[1]']) expect(() => db.sqlite.prepare('UPDATE user_preferences SET navigation_order=?').run(navigation)).toThrow();
    expect(() => db.sqlite.prepare('UPDATE user_preferences SET private_gamification=2').run()).toThrow();
    expect(() => db.sqlite.prepare("UPDATE user_preferences SET theme='remote'").run()).toThrow();
    expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
