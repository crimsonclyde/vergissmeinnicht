import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase, type AppDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

/** A database at 0044 (0.6.0-beta.2 + 18a) with accounts, sessions, memberships and Workspace data. */
async function populatedAt0044(dir: string): Promise<{ path: string; ids: Record<string, string> }> {
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0045');
  writeFileSync(journalPath, JSON.stringify(journal));
  const database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const users = createUserRepository(database);
    const ada = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const bea = await users.create({ email: normalizeEmail('bea@example.org'), displayName: 'Bea Ünïcode', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const cal = await users.create({ email: normalizeEmail('cal@example.org'), displayName: 'Cal', emailVerified: false, status: 'DISABLED', serverAdmin: false });
    const workspace = insertLegacyWorkspace(database, { name: 'Home', adminUserId: ada.id });
    database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'USER', 1, 1)").run(workspace.id, bea.id);
    database.sqlite.prepare("INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, 'token-1', ?, 9999999999999, 1, 1)").run(randomUUID(), bea.id);
    database.sqlite.prepare("INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, '$argon2id$x', 1, 1)").run(randomUUID(), bea.id, bea.id);
    database.sqlite
      .prepare("INSERT INTO lists (id, workspace_id, kind, title, revision, created_by_user_id, created_by_display_name, created_at, updated_at, title_changed_at, title_changed_by_display_name) VALUES (?, ?, 'GROCERY', 'Groceries', 1, ?, 'Bea', 1, 1, 1, 'Bea')")
      .run(randomUUID(), workspace.id, bea.id);
    return { path, ids: { ada: ada.id, bea: bea.id, cal: cal.id, workspace: workspace.id } };
  } finally {
    database.close();
  }
}

describe('migration 0045 (18b): historical identities', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-0045-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const snapshot = (database: AppDatabase) => ({
    users: database.sqlite.prepare('SELECT id, display_name, email, email_verified, image, status, server_admin, created_at, updated_at FROM users ORDER BY id').all(),
    memberships: database.sqlite.prepare('SELECT * FROM memberships ORDER BY user_id').all(),
    sessions: database.sqlite.prepare('SELECT * FROM sessions').all(),
    accounts: database.sqlite.prepare('SELECT * FROM accounts').all(),
    lists: database.sqlite.prepare('SELECT * FROM lists').all(),
  });

  it('upgrades a populated database: every row unchanged, foreign keys and integrity intact, the email index kept', async () => {
    const { path, ids } = await populatedAt0044(dir);
    let database = openDatabase(path);
    const before = snapshot(database);
    database.close();
    expect(runMigrations(path)).toBe('applied');
    database = openDatabase(path);
    try {
      expect(snapshot(database)).toEqual(before);
      expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND name = 'users_email_unique'").get()).toBeDefined();
      expect(() => database.sqlite.prepare("INSERT INTO users (id, display_name, email, status) VALUES (?, 'Dup', 'bea@example.org', 'ACTIVE')").run(randomUUID())).toThrow(/UNIQUE/);
      // Foreign keys still point at the rebuilt table.
      expect(() => database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'USER', 1, 1)").run(ids.workspace, randomUUID())).toThrow(/FOREIGN KEY/);
    } finally {
      database.close();
    }
  });

  it('keeps historical identities apart from accounts in the database itself', async () => {
    const { path, ids } = await populatedAt0044(dir);
    runMigrations(path);
    const database = openDatabase(path);
    try {
      const run = (statement: string, ...values: unknown[]) => () => database.sqlite.prepare(statement).run(...values);
      const imported = randomUUID();
      run("INSERT INTO users (id, display_name, email, status, email_verified, server_admin) VALUES (?, 'Old Owner', ?, 'IMPORTED', 0, 0)", imported, `${imported}@imported.invalid`)();
      // Not without the reserved address, never with it as an account, never admin or verified.
      expect(run("INSERT INTO users (id, display_name, email, status) VALUES (?, 'X', 'x@example.org', 'IMPORTED')", randomUUID())).toThrow(/CHECK/);
      expect(run("INSERT INTO users (id, display_name, email, status) VALUES (?, 'X', 'y@imported.invalid', 'ACTIVE')", randomUUID())).toThrow(/CHECK/);
      const admin = randomUUID();
      expect(run("INSERT INTO users (id, display_name, email, status, server_admin) VALUES (?, 'X', ?, 'IMPORTED', 1)", admin, `${admin}@imported.invalid`)).toThrow(/CHECK/);
      // Never turned into an account, and no account turned into one.
      expect(run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", imported)).toThrow(/never becomes an account|CHECK/);
      expect(run("UPDATE users SET status = 'ACTIVE', email = 'taken@example.org' WHERE id = ?", imported)).toThrow(/never becomes an account/);
      expect(run("UPDATE users SET status = 'IMPORTED' WHERE id = ?", ids.bea)).toThrow(/never becomes a historical identity|CHECK/);
      // No membership, sign-in, credential, recovery or notification channel.
      expect(run("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'GUEST', 1, 1)", ids.workspace, imported)).toThrow(/no memberships/);
      expect(run("UPDATE memberships SET user_id = ? WHERE user_id = ?", imported, ids.bea)).toThrow(/no memberships/);
      expect(run("INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, 'token-2', ?, 9999999999999, 1, 1)", randomUUID(), imported)).toThrow(/cannot sign in/);
      expect(run("INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, '$argon2id$x', 1, 1)", randomUUID(), imported, imported)).toThrow(/no sign-in accounts/);
      expect(run("INSERT INTO account_recoveries (id, user_id, token_hash, reset_password, reset_totp, created_at, expires_at) VALUES (?, ?, ?, 1, 0, 1, 2)", randomUUID(), imported, 'a'.repeat(64))).toThrow(/cannot be recovered/);
      expect(run("INSERT INTO telegram_links (user_id, chat_id, chat_label, connected_at) VALUES (?, '1', 'x', 1)", imported)).toThrow(/no notifications/);
    } finally {
      database.close();
    }
  });

  it('relaxes the history triggers only for a Workspace being restored — never for one with members', async () => {
    const { path, ids } = await populatedAt0044(dir);
    runMigrations(path);
    const database = openDatabase(path);
    try {
      const run = (statement: string, ...values: unknown[]) => () => database.sqlite.prepare(statement).run(...values);
      const link = "INSERT INTO links (id, workspace_id, from_type, from_id, to_type, to_id, created_by_user_id, created_by_display_name, created_at) VALUES (?, ?, 'document', ?, 'procedure', ?, ?, 'Ada', 1)";
      // A live Workspace: the triggers hold, and it cannot be marked.
      expect(run(link, randomUUID(), ids.workspace, randomUUID(), randomUUID(), ids.ada)).toThrow(/a link needs two records/);
      expect(run('INSERT INTO workspace_restore_marks (workspace_id) VALUES (?)', ids.workspace)).toThrow(/only a workspace being restored/);
      expect(run("INSERT INTO run_document_removals (id, workspace_id, run_id, run_document_id, reason, removed_by_user_id, removed_by_display_name, removed_at) VALUES (?, ?, ?, ?, 'x', ?, 'Ada', 1)", randomUUID(), ids.workspace, randomUUID(), randomUUID(), ids.ada)).toThrow();
      // A Workspace without members (one being restored, inside its transaction) can be — and only its rows are relaxed.
      const fresh = randomUUID();
      database.sqlite.prepare("INSERT INTO workspaces (id, name, created_by_user_id, created_at, updated_at) VALUES (?, 'Restored', ?, 1, 1)").run(fresh, ids.ada);
      run('INSERT INTO workspace_restore_marks (workspace_id) VALUES (?)', fresh)();
      expect(run(link, randomUUID(), fresh, randomUUID(), randomUUID(), ids.ada)).not.toThrow();
      expect(run(link, randomUUID(), ids.workspace, randomUUID(), randomUUID(), ids.ada)).toThrow(/a link needs two records/);
    } finally {
      database.close();
    }
  });

  it('rolls back completely when the upgrade fails, and foreign keys are enforced again afterwards', async () => {
    const { path } = await populatedAt0044(dir);
    // An account already using the reserved address cannot satisfy the new rule: the copy fails.
    let database = openDatabase(path);
    database.sqlite.prepare("INSERT INTO users (id, display_name, email, status) VALUES (?, 'Odd', 'odd@imported.invalid', 'ACTIVE')").run(randomUUID());
    const before = snapshot(database);
    const level = database.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get();
    database.close();
    expect(() => runMigrations(path)).toThrow();
    database = openDatabase(path);
    try {
      expect(snapshot(database)).toEqual(before);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(level);
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = '__new_users'").get()).toEqual({ n: 0 });
      expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      database.close();
    }
  });
});
