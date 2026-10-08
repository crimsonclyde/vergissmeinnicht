import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { BackupError, backupDatabase, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { DatabaseNewerError, MIGRATIONS_FOLDER, migrationStatus, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';

const OPS_CLI = resolve(import.meta.dirname, 'ops-cli.ts');
const fingerprint = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * Database version protection (release 0.6.0-beta.3): a database migrated by a newer VergissMeinNicht is never
 * worked on by an older one — `migrationStatus` reports it, `migrate` refuses before writing anything (not even
 * the pre-migration backup), and a server backup made by a newer version is neither verified nor restored.
 * A "newer version" is simulated by a migration in the database that this version's journal does not ship.
 */
describe('a database newer than this version', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-newer-'));
    path = join(dir, 'vergissmeinnicht.sqlite');
    runMigrations(path);
    const database = openDatabase(path);
    await createUserRepository(database).create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    database.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** What a newer version's migration leaves: a row with a later timestamp (and a table of its own). */
  function migrateByNewerVersion(target = path) {
    const database = openDatabase(target);
    database.sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('from-a-newer-version', (SELECT max(created_at) FROM __drizzle_migrations) + 86400000)").run();
    database.sqlite.exec('CREATE TABLE future_feature (id TEXT PRIMARY KEY)');
    database.close();
  }

  it('is told apart from an up-to-date and from an older database', () => {
    const status = (target: string) => {
      const database = openDatabase(target);
      try {
        return migrationStatus(database.sqlite);
      } finally {
        database.close();
      }
    };
    expect(status(path)).toEqual({ pending: false, newer: false });
    // Older: a database at the previous migration level (journal without the last entry).
    const older = join(dir, 'older.sqlite');
    const folder = join(dir, 'migrations');
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, -1);
    writeFileSync(journalPath, JSON.stringify(journal));
    const olderDatabase = openDatabase(older);
    migrate(olderDatabase.db, { migrationsFolder: folder });
    olderDatabase.close();
    expect(status(older)).toEqual({ pending: true, newer: false });
    migrateByNewerVersion();
    expect(status(path)).toEqual({ pending: false, newer: true });
    // Also a migration this version does not ship at an earlier time (a different branch of versions).
    const other = join(dir, 'other.sqlite');
    runMigrations(other);
    const database = openDatabase(other);
    database.sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('unknown', 1)").run();
    database.close();
    expect(status(other).newer).toBe(true);
  });

  it('is not migrated, back-filled or changed by `migrate`', () => {
    migrateByNewerVersion();
    const before = fingerprint(path);
    expect(() => runMigrations(path)).toThrow(DatabaseNewerError);
    expect(fingerprint(path)).toBe(before);
  });

  it('makes the `migrate` command refuse with a clear message — before writing a pre-migration backup', () => {
    migrateByNewerVersion();
    const before = fingerprint(path);
    let failure: { status: number | null; stderr: string } | undefined;
    try {
      execFileSync(process.execPath, [OPS_CLI, 'migrate'], { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = error as { status: number | null; stderr: string };
    }
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toContain('migrated by a newer VergissMeinNicht version');
    expect(fingerprint(path)).toBe(before);
    expect(existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).filter((name) => name.includes('pre-migration')) : []).toEqual([]);
  });

  it('cannot be verified or restored as a server backup by this version, and the database it would replace is untouched', async () => {
    const newerBackup = join(dir, 'newer-backup.sqlite');
    const source = join(dir, 'source.sqlite');
    runMigrations(source);
    migrateByNewerVersion(source);
    // Written as a newer version would (its own backup checks passed there); copied as a file here.
    cpSync(source, newerBackup);
    expect(() => verifyDatabase(newerBackup)).toThrow(BackupError);
    expect(() => verifyDatabase(newerBackup)).toThrow(/made by a newer VergissMeinNicht version/);
    const before = fingerprint(path);
    expect(() => restoreDatabase(newerBackup, path)).toThrow(/made by a newer VergissMeinNicht version/);
    expect(fingerprint(path)).toBe(before);
    // An ordinary backup of this version still verifies and restores.
    const own = join(dir, 'own-backup.sqlite');
    await backupDatabase(path, own);
    expect(verifyDatabase(own)).toEqual({ migrationsPending: false });
  });
});
