import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_TOOLS, normalizeEmail, THEME_PREFERENCES, WORKSPACE_TOOLS } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { createTestDatabase, insertLegacyWorkspace } from './test-support.ts';

describe('lookup tables for theme and tool ids (45.3)', () => {
  it('lists exactly the domain themes and tools, navigable tools marked', () => {
    const database = createTestDatabase();
    try {
      expect(database.sqlite.prepare('SELECT id FROM theme_ids ORDER BY id').all().map((row) => (row as { id: string }).id)).toEqual([...THEME_PREFERENCES].sort());
      const tools = database.sqlite.prepare('SELECT id, navigable FROM tool_ids ORDER BY id').all() as { id: string; navigable: number }[];
      expect(tools.map((row) => row.id)).toEqual([...WORKSPACE_TOOLS].sort());
      expect(tools.filter((row) => row.navigable === 1).map((row) => row.id)).toEqual([...NAVIGATION_TOOLS].sort());
    } finally {
      database.dispose();
    }
  });

  it('refuses unknown ids through the foreign keys and the navigation trigger', async () => {
    const database = createTestDatabase();
    try {
      const user = await createUserRepository(database).create({ email: normalizeEmail('lookup@example.org'), displayName: 'Lookup', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
      const workspace = insertLegacyWorkspace(database, { name: 'Lookup', adminUserId: user.id });
      const insertPrefs = (theme: string, order: string | null) => database.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at) VALUES(?,?,'hold',1,?,1)").run(user.id, theme, order);
      expect(() => insertPrefs('neon-disco', null)).toThrow();
      expect(() => insertPrefs('light', '["PROCEDURES","MOON"]')).toThrow(/navigation/);
      insertPrefs('tokyo-nights', '["MAP","PROCEDURES"]');
      expect(() => database.sqlite.prepare("INSERT INTO user_workspace_preferences(user_id,workspace_id,theme,is_default,updated_at) VALUES(?,?,'neon-disco',0,1)").run(user.id, workspace.id)).toThrow();
      expect(() => database.sqlite.prepare("INSERT INTO workspace_tools(workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'TELEPORTER',1,1,?)").run(workspace.id, user.id)).toThrow();
      // A new theme or tool is one row: no table rebuild.
      database.sqlite.prepare("INSERT INTO theme_ids(id) VALUES('neon-disco')").run();
      database.sqlite.prepare("UPDATE user_preferences SET theme = 'neon-disco' WHERE user_id = ?").run(user.id);
    } finally {
      database.dispose();
    }
  });

  it('keeps populated preference and tool rows on upgrade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmn-lookup-upgrade-')); const path = join(dir, 'db.sqlite'); const before = join(dir, 'migrations');
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const jp = join(before, 'meta/_journal.json'); const journal = JSON.parse(readFileSync(jp, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0085'); writeFileSync(jp, JSON.stringify(journal));
    let db = openDatabase(path);
    try {
      migrate(db.db, { migrationsFolder: before });
      const user = await createUserRepository(db).create({ email: normalizeEmail('upgrade85@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
      const workspace = insertLegacyWorkspace(db, { name: 'Preserved', adminUserId: user.id });
      db.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,private_gamification,navigation_order,updated_at) VALUES(?,'witch-forest','tap-confirm',0,'[\"MAP\",\"BRING\"]',123)").run(user.id);
      db.sqlite.prepare("INSERT INTO user_workspace_preferences(user_id,workspace_id,theme,is_default,updated_at,guide) VALUES(?,?,'places-it',1,456,?)").run(user.id, workspace.id, JSON.stringify({ layout: 'guide', cardStyle: 'glass', cardOpacity: 50, images: true, scopeFilter: true }));
      db.sqlite.prepare("INSERT INTO workspace_tools(workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'MAP',1,789,?)").run(workspace.id, user.id);
      const snapshot = () => ['user_preferences', 'user_workspace_preferences', 'workspace_tools'].map((table) => db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
      const rows = snapshot();
      db.close(); runMigrations(path); db = openDatabase(path);
      expect(snapshot()).toEqual(rows);
      expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      // The rebuilt tables keep their guards.
      expect(() => db.sqlite.prepare("UPDATE user_workspace_preferences SET guide = '{\"layout\":\"guide\"}'").run()).toThrow(/Guide/);
      expect(() => db.sqlite.prepare("UPDATE user_preferences SET navigation_order = '[\"MAP\",\"MAP\"]'").run()).toThrow(/navigation/);
    } finally {
      db.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
});
