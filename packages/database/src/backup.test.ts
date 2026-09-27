import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { BackupError, backupDatabase, defaultBackupPath, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';

const emails = (path: string) => {
  const sqlite = new Database(path, { readonly: true });
  try {
    return (sqlite.prepare('SELECT email FROM users ORDER BY email').all() as { email: string }[]).map((row) => row.email);
  } finally {
    sqlite.close();
  }
};

describe('backup and restore (10.2)', () => {
  let dir: string;
  let live: string;
  let database: ReturnType<typeof openDatabase>;
  const addUser = (email: string) =>
    createUserRepository(database).create({ email: normalizeEmail(email), displayName: email, emailVerified: true, status: 'ACTIVE', serverAdmin: false });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-backup-'));
    live = join(dir, 'data', 'vergissmeinnicht.sqlite');
    runMigrations(live);
    database = openDatabase(live);
    await addUser('ada@example.org');
  });

  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes a consistent, verified, private backup while the server is running', async () => {
    // Uncheckpointed writes live in the WAL of the open connection; the backup must include them.
    await addUser('bob@example.org');
    expect(statSync(`${live}-wal`).size).toBeGreaterThan(0);
    const target = defaultBackupPath(live, new Date('2026-09-27T12:00:00.000Z'));
    expect(target).toBe(join(dir, 'data', 'backups', 'vergissmeinnicht-2026-09-27T12-00-00.000Z.sqlite'));
    const { bytes } = await backupDatabase(live, target);
    expect(bytes).toBeGreaterThan(0);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'data', 'backups')).mode & 0o777).toBe(0o700);
    expect(emails(target)).toEqual(['ada@example.org', 'bob@example.org']);
    expect(verifyDatabase(target)).toEqual({ migrationsPending: false });
    // Self-contained: reading the backup leaves no sidecar files.
    expect(readdirSync(join(dir, 'data', 'backups'))).toEqual(['vergissmeinnicht-2026-09-27T12-00-00.000Z.sqlite']);
    await expect(backupDatabase(live, target)).rejects.toThrow(/already exists/);
  });

  it('restores a backup, keeping the replaced database aside, after the server stopped', async () => {
    const backup = join(dir, 'backup.sqlite');
    await backupDatabase(live, backup);
    await addUser('carol@example.org');
    // While the server runs, restore is refused — also when its WAL is empty (idle after a checkpoint).
    expect(() => restoreDatabase(backup, live)).toThrow(/stop the server first/);
    database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    expect(statSync(`${live}-wal`).size).toBe(0);
    expect(() => restoreDatabase(backup, live)).toThrow(/stop the server first/);
    expect(emails(live)).toEqual(['ada@example.org', 'carol@example.org']);

    database.close();
    const { previous, migrationsPending } = restoreDatabase(backup, live, { now: new Date('2026-09-28T08:00:00.000Z') });
    expect(migrationsPending).toBe(false);
    expect(previous).toBe(`${live}.before-restore-2026-09-28T08-00-00.000Z`);
    expect(emails(live)).toEqual(['ada@example.org']);
    expect(emails(previous ?? '')).toEqual(['ada@example.org', 'carol@example.org']);
    expect(statSync(live).mode & 0o777).toBe(0o600);
    // The restored database works normally again.
    database = openDatabase(live);
    await addUser('dave@example.org');
    expect(verifyDatabase(live).migrationsPending).toBe(false);
  });

  it('restores into an empty location and reports an older schema', async () => {
    const backup = join(dir, 'old.sqlite');
    await backupDatabase(live, backup);
    const old = new Database(backup);
    old.prepare('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)').run();
    old.close();
    const fresh = join(dir, 'elsewhere', 'db.sqlite');
    expect(restoreDatabase(backup, fresh)).toEqual({ previous: null, migrationsPending: true });
    expect(existsSync(fresh)).toBe(true);
  });

  it('backs up an older schema and never leaves an unverified backup behind', async () => {
    const old = join(dir, 'old-schema.sqlite');
    const legacy = new Database(old);
    legacy.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC); CREATE TABLE users (id TEXT PRIMARY KEY)");
    legacy.close();
    expect(verifyDatabase(old)).toEqual({ migrationsPending: true });
    await backupDatabase(old, join(dir, 'old-backup.sqlite'));

    const notOurs = join(dir, 'not-ours.sqlite');
    const other = new Database(notOurs);
    other.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)');
    other.close();
    const target = join(dir, 'bad-backup.sqlite');
    await expect(backupDatabase(notOurs, target)).rejects.toThrow(/not a VergissMeinNicht database/);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses files that are not intact VergissMeinNicht databases, changing nothing', async () => {
    const garbage = join(dir, 'garbage.sqlite');
    writeFileSync(garbage, 'not a database at all, just text '.repeat(200));
    const foreign = join(dir, 'foreign.sqlite');
    const other = new Database(foreign);
    other.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)');
    other.close();
    database.close();
    const mainFiles = () => readdirSync(join(dir, 'data')).filter((name) => !/-(wal|shm)$/.test(name)).sort();
    const before = mainFiles();
    for (const [file, message] of [
      [garbage, /not a readable SQLite database/],
      [foreign, /not a VergissMeinNicht database/],
      [join(dir, 'missing.sqlite'), /does not exist/],
      [live, /same file/],
    ] as const) {
      expect(() => restoreDatabase(file, live), String(message)).toThrow(message);
    }
    expect(() => restoreDatabase(garbage, live)).toThrow(BackupError);
    expect(mainFiles()).toEqual(before);
    expect(emails(live)).toEqual(['ada@example.org']);
    database = openDatabase(live);
  });
});
