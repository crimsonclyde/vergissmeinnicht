import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrationStatus } from './migrate.ts';

/**
 * Consistent SQLite backups and restores (Step 10.2). A backup contains everything sensitive the
 * database holds (password hashes, session tokens, encrypted TOTP seeds, audit history): it is
 * written with mode 0600 in a 0700 directory and must be stored like the live database. The
 * DATA_ENCRYPTION_KEY is *not* in it and has to be backed up separately.
 */

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Present since the first migration; older schemas are valid backups (reported as migrations pending). */
const REQUIRED_TABLES = ['__drizzle_migrations', 'users'];

/** Checks that `path` is an intact Vergissmeinnicht database. Opens it read-only. */
export function verifyDatabase(path: string): { readonly migrationsPending: boolean } {
  if (!existsSync(path)) throw new BackupError('file does not exist');
  let sqlite: Database.Database;
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    throw new BackupError('not a readable SQLite database');
  }
  try {
    let integrity: string;
    try {
      integrity = sqlite.pragma('integrity_check', { simple: true }) as string;
    } catch {
      throw new BackupError('not a readable SQLite database');
    }
    if (integrity !== 'ok') throw new BackupError('integrity check failed');
    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name),
    );
    if (!REQUIRED_TABLES.every((table) => tables.has(table))) throw new BackupError('not a Vergissmeinnicht database');
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) throw new BackupError('foreign key check failed');
    return { migrationsPending: migrationStatus(sqlite).pending };
  } finally {
    sqlite.close();
  }
}

/**
 * Online backup via SQLite's backup API: consistent even while the server is running and writing
 * (WAL included). Never overwrites an existing file. The result is verified before returning.
 */
export async function backupDatabase(sourcePath: string, targetPath: string): Promise<{ readonly bytes: number }> {
  if (!existsSync(sourcePath)) throw new BackupError('database does not exist');
  if (existsSync(targetPath)) throw new BackupError('backup target already exists');
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(targetPath);
  } finally {
    source.close();
  }
  chmodSync(targetPath, 0o600);
  try {
    finishBackup(targetPath);
  } catch (error) {
    // Our own unverified output is never left behind looking like a backup.
    rmSync(targetPath, { force: true });
    throw error;
  }
  return { bytes: statSync(targetPath).size };
}

function finishBackup(targetPath: string): void {
  // One self-contained file: without WAL mode, reading the backup never creates -wal/-shm files
  // next to it. The server switches a restored database back to WAL when it opens it.
  const backup = new Database(targetPath);
  try {
    backup.pragma('journal_mode = DELETE');
  } finally {
    backup.close();
  }
  verifyDatabase(targetPath);
}

/**
 * Replaces the database at `targetPath` with a verified backup. The server must be stopped: the
 * restore takes an exclusive SQLite lock on the current database without waiting, which fails while
 * any other connection (the running server, even when idle) has it open. `force` skips this check
 * and is only for a database that is known to be unused. The replaced database (with its WAL/SHM
 * files) is kept next to it as `<name>.before-restore-<time>`, never deleted. Run migrations
 * afterwards if the backup has an older schema.
 */
export function restoreDatabase(
  backupPath: string,
  targetPath: string,
  options: { readonly force?: boolean; readonly now?: Date } = {},
): { readonly previous: string | null; readonly migrationsPending: boolean } {
  const { migrationsPending } = verifyDatabase(backupPath);
  if (resolve(backupPath) === resolve(targetPath)) throw new BackupError('backup and database are the same file');
  const lock = existsSync(targetPath) && !options.force ? lockExclusively(targetPath) : undefined;
  try {
    let previous: string | null = null;
    if (existsSync(targetPath)) {
      const stamp = (options.now ?? new Date()).toISOString().replaceAll(':', '-');
      previous = `${targetPath}.before-restore-${stamp}`;
      renameSync(targetPath, previous);
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${targetPath}${suffix}`)) renameSync(`${targetPath}${suffix}`, `${previous}${suffix}`);
      }
    } else {
      mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    }
    copyFileSync(backupPath, targetPath);
    chmodSync(targetPath, 0o600);
    return { previous, migrationsPending };
  } finally {
    lock?.close();
  }
}

/** An exclusive lock on the database, or BackupError if another connection has it open. */
function lockExclusively(path: string): Database.Database {
  const sqlite = new Database(path, { fileMustExist: true, timeout: 0 });
  try {
    sqlite.pragma('locking_mode = EXCLUSIVE');
    sqlite.exec('BEGIN EXCLUSIVE');
    sqlite.exec('COMMIT');
    return sqlite;
  } catch {
    sqlite.close();
    throw new BackupError('the database is in use: stop the server first');
  }
}

/** Default backup file: `<database dir>/backups/vergissmeinnicht-<UTC time>.sqlite`. */
export function defaultBackupPath(databasePath: string, now: Date = new Date()): string {
  return join(dirname(databasePath), 'backups', `vergissmeinnicht-${now.toISOString().replaceAll(':', '-')}.sqlite`);
}
