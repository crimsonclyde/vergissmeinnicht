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

const GUIDE = '{"layout":"classic","cardStyle":"starfield","cardOpacity":28,"images":false}';

it('0069 gives each Workspace member the account Guide, leaves outsiders untouched and removes the account Guide', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0069-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0069');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const users = createUserRepository(database);
    const person = (email: string, displayName: string) => users.create({ email: normalizeEmail(email), displayName, emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const admin = await person('admin69@example.org', 'Admin');
    const alice = await person('alice69@example.org', 'Alice');
    const bob = await person('bob69@example.org', 'Bob');
    const carol = await person('carol69@example.org', 'Carol');
    const home = insertLegacyWorkspace(database, { name: 'Home', adminUserId: admin.id });
    const van = insertLegacyWorkspace(database, { name: 'Van', adminUserId: admin.id });
    const member = database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'GUEST', 1, 1)");
    member.run(home.id, alice.id);
    member.run(van.id, alice.id);
    member.run(home.id, bob.id);
    // Carol has an account Guide but is a member of neither Workspace; the admin is a member but has no account row.
    const account = database.sqlite.prepare("INSERT INTO user_preferences (user_id, theme, critical_confirm, guide, private_gamification, navigation_order, updated_at) VALUES (?, 'system', 'hold', ?, 1, NULL, 1)");
    account.run(alice.id, GUIDE);
    account.run(bob.id, GUIDE);
    account.run(carol.id, GUIDE);
    // Alice's existing Home row keeps its theme and default; Carol's row for Home is not a membership and stays as it is.
    database.sqlite.prepare("INSERT INTO user_workspace_preferences (user_id, workspace_id, theme, is_default, updated_at) VALUES (?, ?, 'witch-forest', 1, 5)").run(alice.id, home.id);
    database.sqlite.prepare("INSERT INTO user_workspace_preferences (user_id, workspace_id, theme, is_default, updated_at) VALUES (?, ?, 'dark', 0, 5)").run(carol.id, home.id);
    database.close();

    runMigrations(path);
    database = openDatabase(path);
    const row = (userId: string, workspaceId: string) => database.sqlite.prepare('SELECT theme, is_default, guide FROM user_workspace_preferences WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId);
    expect(row(alice.id, home.id)).toEqual({ theme: 'witch-forest', is_default: 1, guide: GUIDE });
    expect(row(alice.id, van.id)).toEqual({ theme: null, is_default: 0, guide: GUIDE });
    expect(row(bob.id, home.id)).toEqual({ theme: null, is_default: 0, guide: GUIDE });
    expect(row(admin.id, home.id)).toBeUndefined();
    expect(row(admin.id, van.id)).toBeUndefined();
    expect(row(carol.id, home.id)).toEqual({ theme: 'dark', is_default: 0, guide: null });
    expect(row(carol.id, van.id)).toBeUndefined();

    expect((database.sqlite.pragma('table_info(user_preferences)') as { name: string }[]).map((column) => column.name)).not.toContain('guide');
    expect(database.sqlite.prepare('SELECT theme, critical_confirm FROM user_preferences WHERE user_id = ?').get(alice.id)).toEqual({ theme: 'system', critical_confirm: 'hold' });

    // The Workspace Guide keeps the bounds the account Guide had.
    const update = database.sqlite.prepare('UPDATE user_workspace_preferences SET guide = ? WHERE user_id = ? AND workspace_id = ?');
    for (const cardStyle of ['glass', 'starfield', 'forest', 'water', 'hearth']) expect(() => update.run(`{"layout":"guide","cardStyle":"${cardStyle}","cardOpacity":50,"images":true}`, alice.id, van.id)).not.toThrow();
    for (const value of ['{"layout":"remote","cardStyle":"glass","cardOpacity":50,"images":true}', '{"layout":"guide","cardStyle":"url(https://bad.test)","cardOpacity":50,"images":true}', '{"layout":"guide","cardStyle":"glass","cardOpacity":101,"images":true}', '{"layout":"guide","cardStyle":"glass","cardOpacity":50,"images":true,"extra":true}']) {
      expect(() => update.run(value, alice.id, van.id)).toThrow();
    }
    // A row with no theme, no default and no Guide would be empty, so it is refused.
    expect(() => database.sqlite.prepare('UPDATE user_workspace_preferences SET guide = NULL WHERE user_id = ? AND workspace_id = ?').run(bob.id, home.id)).toThrow(/CHECK constraint failed/);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
