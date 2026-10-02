import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, createReadStream, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { copyFile, link, open, rename, rm } from 'node:fs/promises';
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

/**
 * Instruction image files (14.3, T1) live next to the database: `<database dir>/media/<xx>/<sha256>.jpg`
 * (the layout of `@vergissmeinnicht/media`'s file store). A backup is its database file plus the image
 * files it references, kept in a shared, hash-named store next to the backup files
 * (`<backup dir>/media`): images are immutable, so consecutive backups share them instead of copying
 * them into every backup file.
 */
const SHA256 = /^[0-9a-f]{64}$/;
/** A backup store file is only pruned when no backup used it for this long (a backup in progress refreshes it). */
const PRUNE_AFTER_MS = 60 * 60_000;

export function defaultMediaPath(databasePath: string): string {
  return join(dirname(databasePath), 'media');
}

/** Files of Documents (16.1, HT2) live next to the database as well: `<database dir>/documents/<xx>/<sha256>`. */
export function defaultDocumentsPath(databasePath: string): string {
  return join(dirname(databasePath), 'documents');
}

/** The image store that belongs to a backup file. */
export function backupMediaPath(backupPath: string): string {
  return join(dirname(backupPath), 'media');
}

export function mediaFilePath(mediaPath: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new BackupError('invalid image hash');
  return join(mediaPath, sha256.slice(0, 2), `${sha256}.jpg`);
}

const hasTable = (sqlite: Database.Database, name: string) =>
  sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** The image files a database uses (none before migration 0025). */
function imageHashes(sqlite: Database.Database): string[] {
  if (!hasTable(sqlite, 'step_images')) return [];
  return (sqlite.prepare('SELECT DISTINCT sha256 FROM step_images').all() as { sha256: string }[]).map((row) => row.sha256);
}

const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Atomic private copy: temporary file, fsync, rename. */
function writeFileAtomically(mediaPath: string, sha256: string, bytes: Buffer): void {
  const target = mediaFilePath(mediaPath, sha256);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = join(mediaPath, `.copy-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, target);
}

/** Every image file the database uses exists in `mediaPath` and matches its hash. */
function verifyMedia(sqlite: Database.Database, mediaPath: string): void {
  for (const sha256 of imageHashes(sqlite)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(mediaFilePath(mediaPath, sha256));
    } catch {
      throw new BackupError('an image file of the backup is missing');
    }
    if (sha256Of(bytes) !== sha256) throw new BackupError('an image file of the backup is damaged');
  }
}

/**
 * Copies the image files the backup's rows use into the backup store. Files are immutable and written
 * before their row exists, so every row of the snapshot has its file — except rows of unused images
 * whose file housekeeping removed after the snapshot: those rows are dropped from the backup too.
 * Files already in the store are kept (and their time refreshed, so pruning leaves them alone).
 */
function copyMedia(targetPath: string, liveMediaPath: string): void {
  const backup = new Database(targetPath);
  try {
    const store = backupMediaPath(targetPath);
    const dropUnused = hasTable(backup, 'step_images')
      ? backup.prepare(
          'DELETE FROM step_images WHERE sha256 = ? AND id NOT IN (SELECT image_id FROM procedure_steps WHERE image_id IS NOT NULL) AND id NOT IN (SELECT image_id FROM run_steps WHERE image_id IS NOT NULL)',
        )
      : undefined;
    for (const sha256 of imageHashes(backup)) {
      const stored = mediaFilePath(store, sha256);
      if (existsSync(stored)) {
        const now = new Date();
        utimesSync(stored, now, now);
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(mediaFilePath(liveMediaPath, sha256));
      } catch {
        dropUnused?.run(sha256);
        if (backup.prepare('SELECT 1 FROM step_images WHERE sha256 = ?').get(sha256) !== undefined) throw new BackupError('an image file is missing');
        continue;
      }
      if (sha256Of(bytes) !== sha256) throw new BackupError('an image file is damaged');
      writeFileAtomically(store, sha256, bytes);
    }
  } finally {
    backup.close();
  }
}

/**
 * Removes files from a backup store that no backup file in `backupDir` uses any more. Does nothing
 * if any backup file there cannot be read (e.g. one being written), and keeps recently used files.
 */
export function pruneBackupMedia(backupDir: string, now: Date = new Date()): number {
  const store = join(backupDir, 'media');
  if (!existsSync(store)) return 0;
  const used = new Set<string>();
  for (const name of readdirSync(backupDir).filter((entry) => entry.endsWith('.sqlite'))) {
    try {
      const sqlite = new Database(join(backupDir, name), { readonly: true, fileMustExist: true });
      try {
        for (const sha256 of imageHashes(sqlite)) used.add(sha256);
      } finally {
        sqlite.close();
      }
    } catch {
      return 0;
    }
  }
  let removed = 0;
  for (const prefix of readdirSync(store).filter((entry) => /^[0-9a-f]{2}$/.test(entry))) {
    for (const name of readdirSync(join(store, prefix))) {
      const sha256 = name.replace(/\.jpg$/, '');
      const path = join(store, prefix, name);
      if (!SHA256.test(sha256) || used.has(sha256) || now.getTime() - statSync(path).mtimeMs < PRUNE_AFTER_MS) continue;
      rmSync(path, { force: true });
      removed++;
    }
  }
  return removed;
}

/**
 * Files of Documents (16.1, HT2) — originals up to 100 MB, gigabytes per Workspace — are backed up into
 * `<backup dir>/documents`, a shared hash-named store like the image store. Because the files are
 * immutable and the backups normally sit on the same volume as the data, a file is added by a **hard
 * link** (no copy, no extra space); only when that is impossible (another file system) is it copied.
 * Either way its content is hashed once when it enters the store. A backup therefore protects against
 * loss inside the application (a permanent deletion, a bad migration, a bug) and keeps the file until
 * the last backup that needs it rotates out; protection against the loss of the disk is the off-host
 * copy of the backup directory, as for the database. Derived previews are included, so a restore does
 * not need to draw them again.
 */
export function backupDocumentsPath(backupPath: string): string {
  return join(dirname(backupPath), 'documents');
}

export function documentFilePath(documentsPath: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new BackupError('invalid file hash');
  return join(documentsPath, sha256.slice(0, 2), sha256);
}

/** The files a database's Documents use — originals and derived files — with their sizes (none before migration 0027). */
function documentFiles(sqlite: Database.Database): { sha256: string; bytes: number }[] {
  if (!hasTable(sqlite, 'document_files')) return [];
  return sqlite.prepare('SELECT sha256, max(bytes) AS bytes FROM (SELECT sha256, bytes FROM document_files UNION ALL SELECT sha256, bytes FROM document_file_derivatives) GROUP BY sha256').all() as {
    sha256: string;
    bytes: number;
  }[];
}

/** SHA-256 of a file read in pieces (files of up to 100 MB are never held in memory). */
function hashFileSync(path: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1 << 20);
  const fd = openSync(path, 'r');
  try {
    for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; read = readSync(fd, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Puts `source` into the store as `target`: a hard link where possible, otherwise a private fsynced copy. Returns how. */
async function linkOrCopy(source: string, target: string): Promise<'linked' | 'copied'> {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await link(source, target);
    return 'linked';
  } catch (error) {
    if (isMissing(error)) throw error;
    // Another file system, or one without hard links: copy.
  }
  const temporary = join(dirname(dirname(target)), `.copy-${randomUUID()}`);
  try {
    await copyFile(source, temporary);
    chmodSync(temporary, 0o600);
    const handle = await open(temporary, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return 'copied';
}

/** How long an upload nothing refers to is kept before housekeeping removes it (as `DOCUMENT_FILE_PENDING_MS`). */
const DOCUMENT_FILE_GRACE_MS = 24 * 60 * 60_000;

/**
 * Adds the files the backup's rows use to the backup store. Files already there are kept (their time
 * refreshed, so pruning leaves them alone); a new one is hashed as it enters. Rows whose file
 * housekeeping removed after the snapshot was taken are dropped from the backup: only uploads that are
 * on no page of a Document and past the grace period can be in that state (the repository's rule for
 * what housekeeping may delete). A file of a Document that is missing fails the backup. A missing derived file is no loss:
 * its row is dropped and the file's previews are made again after a restore.
 */
async function copyDocuments(targetPath: string, liveDocumentsPath: string, now: Date): Promise<void> {
  const backup = new Database(targetPath);
  try {
    const store = backupDocumentsPath(targetPath);
    for (const { sha256 } of documentFiles(backup)) {
      const stored = documentFilePath(store, sha256);
      if (existsSync(stored)) {
        utimesSync(stored, now, now);
        continue;
      }
      try {
        await linkOrCopy(documentFilePath(liveDocumentsPath, sha256), stored);
      } catch (error) {
        if (!isMissing(error)) throw new BackupError('a document file could not be copied');
        backup.prepare("UPDATE document_files SET preview_state = 'PENDING', preview_attempts = 0 WHERE id IN (SELECT file_id FROM document_file_derivatives WHERE sha256 = ?)").run(sha256);
        backup.prepare('DELETE FROM document_file_derivatives WHERE sha256 = ?').run(sha256);
        // Before migration 0028 there are no Documents: every upload is provisional.
        const expiredUploads = hasTable(backup, 'document_pages')
          ? backup.prepare('SELECT id FROM document_files WHERE sha256 = ? AND created_at < ? AND id NOT IN (SELECT file_id FROM document_pages)')
          : backup.prepare('SELECT id FROM document_files WHERE sha256 = ? AND created_at < ?');
        const expired = expiredUploads.all(sha256, now.getTime() - DOCUMENT_FILE_GRACE_MS) as { id: string }[];
        for (const { id } of expired) {
          backup.prepare('DELETE FROM document_file_derivatives WHERE file_id = ?').run(id);
          backup.prepare('DELETE FROM document_files WHERE id = ?').run(id);
        }
        if (backup.prepare('SELECT 1 FROM document_files WHERE sha256 = ?').get(sha256) !== undefined) throw new BackupError('a document file is missing');
        continue;
      }
      if ((await hashFile(stored)) !== sha256) {
        rmSync(stored, { force: true });
        throw new BackupError('a document file is damaged');
      }
    }
  } finally {
    backup.close();
  }
}

/**
 * Every file the database's Documents use is in `documentsPath`. `full` reads and hashes each file
 * (`verify`, `restore`); `present` checks existence and size only — enough right after a backup, whose
 * files were hashed when they entered the store.
 */
function verifyDocuments(sqlite: Database.Database, documentsPath: string, mode: 'full' | 'present'): void {
  for (const { sha256, bytes } of documentFiles(sqlite)) {
    const path = documentFilePath(documentsPath, sha256);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw new BackupError('a document file of the backup is missing');
    }
    if (size !== bytes || (mode === 'full' && hashFileSync(path) !== sha256)) throw new BackupError('a document file of the backup is damaged');
  }
}

/**
 * Puts the backup's document files into the live store before the database is replaced (the backup was
 * verified in full). A file already there with the right content is kept; anything else is replaced.
 */
function restoreDocuments(backupPath: string, liveDocumentsPath: string): void {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    for (const { sha256, bytes } of documentFiles(backup)) {
      const live = documentFilePath(liveDocumentsPath, sha256);
      if (existsSync(live)) {
        if (statSync(live).size === bytes && hashFileSync(live) === sha256) continue;
        rmSync(live, { force: true });
      }
      mkdirSync(dirname(live), { recursive: true, mode: 0o700 });
      const stored = documentFilePath(backupDocumentsPath(backupPath), sha256);
      try {
        linkSync(stored, live);
      } catch {
        const temporary = join(liveDocumentsPath, `.copy-${randomUUID()}`);
        copyFileSync(stored, temporary);
        chmodSync(temporary, 0o600);
        const fd = openSync(temporary, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, live);
      }
    }
  } finally {
    backup.close();
  }
}

/** Removes document files from a backup store that no backup in `backupDir` uses any more (as `pruneBackupMedia`). */
export function pruneBackupDocuments(backupDir: string, now: Date = new Date()): number {
  const store = join(backupDir, 'documents');
  if (!existsSync(store)) return 0;
  const used = new Set<string>();
  for (const name of readdirSync(backupDir).filter((entry) => entry.endsWith('.sqlite'))) {
    try {
      const sqlite = new Database(join(backupDir, name), { readonly: true, fileMustExist: true });
      try {
        for (const { sha256 } of documentFiles(sqlite)) used.add(sha256);
      } finally {
        sqlite.close();
      }
    } catch {
      return 0;
    }
  }
  let removed = 0;
  for (const prefix of readdirSync(store).filter((entry) => /^[0-9a-f]{2}$/.test(entry))) {
    for (const name of readdirSync(join(store, prefix))) {
      const path = join(store, prefix, name);
      if (!SHA256.test(name) || used.has(name) || now.getTime() - statSync(path).mtimeMs < PRUNE_AFTER_MS) continue;
      rmSync(path, { force: true });
      removed++;
    }
  }
  return removed;
}

/** Present since the first migration; older schemas are valid backups (reported as migrations pending). */
const REQUIRED_TABLES = ['__drizzle_migrations', 'users'];

/**
 * Checks that `path` is an intact backup: database, image files (by default in `<backup dir>/media`)
 * and document files (`<backup dir>/documents`) — each read and compared with its hash, unless
 * `documents` is `'present'` (existence and size only).
 */
export function verifyDatabase(
  path: string,
  options: { readonly mediaPath?: string; readonly documentsPath?: string; readonly documents?: 'full' | 'present' } = {},
): { readonly migrationsPending: boolean } {
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
    if (!REQUIRED_TABLES.every((table) => tables.has(table))) throw new BackupError('not a VergissMeinNicht database');
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) throw new BackupError('foreign key check failed');
    verifyMedia(sqlite, options.mediaPath ?? backupMediaPath(path));
    verifyDocuments(sqlite, options.documentsPath ?? backupDocumentsPath(path), options.documents ?? 'full');
    return { migrationsPending: migrationStatus(sqlite).pending };
  } finally {
    sqlite.close();
  }
}

/**
 * Online backup via SQLite's backup API: consistent even while the server is running and writing
 * (WAL included). Never overwrites an existing file. The result is verified before returning.
 */
export async function backupDatabase(
  sourcePath: string,
  targetPath: string,
  options: { readonly mediaPath?: string; readonly documentsPath?: string; readonly now?: Date } = {},
): Promise<{ readonly bytes: number }> {
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
    copyMedia(targetPath, options.mediaPath ?? defaultMediaPath(sourcePath));
    await copyDocuments(targetPath, options.documentsPath ?? defaultDocumentsPath(sourcePath), options.now ?? new Date());
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
  // Document files were hashed when they entered the backup store: here only their presence and size.
  verifyDatabase(targetPath, { documents: 'present' });
}

/**
 * Replaces the database at `targetPath` (and adds its image files to the media directory) with a verified backup. The server must be stopped: the
 * restore takes an exclusive SQLite lock on the current database without waiting, which fails while
 * any other connection (the running server, even when idle) has it open. `force` skips this check
 * and is only for a database that is known to be unused. The replaced database (with its WAL/SHM
 * files) is kept next to it as `<name>.before-restore-<time>`, never deleted. Run migrations
 * afterwards if the backup has an older schema.
 */
export function restoreDatabase(
  backupPath: string,
  targetPath: string,
  options: { readonly force?: boolean; readonly now?: Date; readonly mediaPath?: string; readonly documentsPath?: string } = {},
): { readonly previous: string | null; readonly migrationsPending: boolean } {
  const { migrationsPending } = verifyDatabase(backupPath);
  if (resolve(backupPath) === resolve(targetPath)) throw new BackupError('backup and database are the same file');
  const lock = existsSync(targetPath) && !options.force ? lockExclusively(targetPath) : undefined;
  try {
    // Images first: if this fails, the current database is still in place (extra files are harmless).
    restoreMedia(backupPath, options.mediaPath ?? defaultMediaPath(targetPath));
    restoreDocuments(backupPath, options.documentsPath ?? defaultDocumentsPath(targetPath));
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

/**
 * Copies the backup's image files into the live media directory before the database is replaced
 * (the backup was verified, so the set is complete). A file already there with the right content is
 * kept; one that does not match its name is replaced. Files of the replaced database that nothing
 * uses any more are removed later by housekeeping.
 */
function restoreMedia(backupPath: string, liveMediaPath: string): void {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    for (const sha256 of imageHashes(backup)) {
      const live = mediaFilePath(liveMediaPath, sha256);
      if (existsSync(live) && sha256Of(readFileSync(live)) === sha256) continue;
      writeFileAtomically(liveMediaPath, sha256, readFileSync(mediaFilePath(backupMediaPath(backupPath), sha256)));
    }
  } finally {
    backup.close();
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

/** Automatic backups (Step 10.5) have their own prefix, so retention never touches manual or pre-migration backups. */
const AUTO_PREFIX = 'vergissmeinnicht-auto-';
const AUTO_NAME = /^vergissmeinnicht-auto-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)\.sqlite$/;

export function automaticBackupPath(databasePath: string, now: Date = new Date()): string {
  return join(dirname(databasePath), 'backups', `${AUTO_PREFIX}${now.toISOString().replaceAll(':', '-')}.sqlite`);
}

/** Automatic backups next to the database, oldest first. */
export function listAutomaticBackups(databasePath: string): { readonly path: string; readonly at: Date }[] {
  const dir = join(dirname(databasePath), 'backups');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, match: AUTO_NAME.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({ path: join(dir, name), at: new Date((match[1] ?? '').replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')) }))
    .filter((entry) => !Number.isNaN(entry.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Scheduled backup (Step 10.5): writes a verified automatic backup when the newest one is older than
 * `intervalMs` (or none exists), then keeps only the newest `keep` automatic backups. Deciding from
 * the files on disk makes restarts neither skip nor repeat backups. Returns what was done.
 */
export async function backupIfDue(
  databasePath: string,
  options: { readonly intervalMs: number; readonly keep: number; readonly now?: Date },
): Promise<{ readonly written: string | null; readonly removed: readonly string[] }> {
  const now = options.now ?? new Date();
  const newest = listAutomaticBackups(databasePath).at(-1);
  let written: string | null = null;
  if (newest === undefined || now.getTime() - newest.at.getTime() >= options.intervalMs) {
    written = automaticBackupPath(databasePath, now);
    await backupDatabase(databasePath, written, { now });
  }
  const all = listAutomaticBackups(databasePath);
  const removed = all.slice(0, Math.max(0, all.length - options.keep)).map((entry) => entry.path);
  for (const path of removed) rmSync(path, { force: true });
  // Image files only the removed backups used (14.3).
  pruneBackupMedia(join(dirname(databasePath), 'backups'), now);
  // … and document files (16.1).
  pruneBackupDocuments(join(dirname(databasePath), 'backups'), now);
  return { written, removed };
}
