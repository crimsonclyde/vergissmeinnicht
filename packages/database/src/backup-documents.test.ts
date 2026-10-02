import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_PENDING_MS,
  createPreviewQueue,
  createWorkspace,
  purgeUnusedDocumentFiles,
  uploadDocumentFile,
  type DocumentFileDeps,
  type DocumentFileProcessor,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore, documentFilePath as storePath } from '@vergissmeinnicht/media';
import { BackupError, backupDatabase, backupDocumentsPath, backupIfDue, defaultDocumentsPath, documentFilePath, listAutomaticBackups, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createWorkspaceToolRepository } from './document-repository.ts';
import { runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
/** Every test file is a one-page "PDF"; its preview and thumbnail are small texts derived from it. */
const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'PDF', pageCount: 1, width: null, height: null, encrypted: false, activeContent: false }),
  renderPage: async (path) => ({ jpeg: new TextEncoder().encode(`preview of ${sha256(readFileSync(path))}`), width: 100, height: 100 }),
  thumbnail: async (preview) => ({ jpeg: new TextEncoder().encode(`thumbnail of ${sha256(preview)}`), width: 10, height: 10 }),
};

describe('backups with document files (16.1, HT2)', () => {
  let dir: string;
  let live: string;
  let documents: string;
  let database: ReturnType<typeof openDatabase>;
  let deps: DocumentFileDeps;
  let now: Date;
  let ada: User;
  let home: Workspace;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-backup-documents-'));
    live = join(dir, 'data', 'vergissmeinnicht.sqlite');
    documents = defaultDocumentsPath(live);
    runMigrations(live);
    database = openDatabase(live);
    now = new Date();
    const clock = { now: () => now };
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    ada = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    home = await createWorkspace({ users, workspaces, clock }, { actor: ada, name: 'Home' });
    const files = createDocumentFileRepository(database);
    const store = createDocumentFileStore(documents);
    const tools = createWorkspaceToolRepository(database);
    await tools.set({ workspaceId: home.id, tool: 'DOCUMENTS', enabled: true, at: now }, { kind: 'user', userId: ada.id, displayName: ada.displayName }, { actorMay: () => true });
    deps = { workspaces, tools, files, store, processor, clock, previews: createPreviewQueue({ files, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['PDF'] }) };
  });
  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const upload = async (text: string) =>
    (
      await uploadDocumentFile(deps, {
        actor: ada,
        workspaceId: home.id,
        name: 'bill.pdf',
        source: (async function* () {
          yield new TextEncoder().encode(text);
        })(),
      })
    ).file;
  const hashesOf = (path: string) => {
    const sqlite = new Database(path, { readonly: true });
    try {
      return (sqlite.prepare('SELECT sha256 FROM document_files UNION SELECT sha256 FROM document_file_derivatives').all() as { sha256: string }[]).map((row) => row.sha256);
    } finally {
      sqlite.close();
    }
  };

  it('keeps the file layout of the document store', () => {
    const sha = 'a'.repeat(64);
    expect(documentFilePath('/data/documents', sha)).toBe(storePath('/data/documents', sha));
    expect(defaultDocumentsPath('/data/vergissmeinnicht.sqlite')).toBe('/data/documents');
    expect(backupDocumentsPath('/data/backups/x.sqlite')).toBe('/data/backups/documents');
    expect(() => documentFilePath('/data/documents', '../x')).toThrow(BackupError);
  });

  it('backs up originals and previews without copying them, and restores them byte-identical onto a fresh volume', async () => {
    const file = await upload('the original water bill');
    const backup = join(dir, 'data', 'backups', 'manual.sqlite');
    await backupDatabase(live, backup);
    const hashes = hashesOf(backup);
    expect(hashes).toHaveLength(3); // original, preview, thumbnail
    const stored = documentFilePath(backupDocumentsPath(backup), file.sha256);
    expect(readFileSync(stored, 'utf8')).toBe('the original water bill');
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    // The same file on disk as the live one: a hard link, no second copy of the bytes.
    expect(statSync(stored).ino).toBe(statSync(documentFilePath(documents, file.sha256)).ino);
    expect(verifyDatabase(backup).migrationsPending).toBe(false);

    // The backup still has the file after the live data lost it (a permanent deletion, a mistake).
    rmSync(documentFilePath(documents, file.sha256));
    expect(readFileSync(stored, 'utf8')).toBe('the original water bill');

    const target = join(dir, 'fresh', 'vergissmeinnicht.sqlite');
    restoreDatabase(backup, target);
    for (const hash of hashes) expect(sha256(readFileSync(documentFilePath(defaultDocumentsPath(target), hash)))).toBe(hash);
    expect(hashesOf(target).sort()).toEqual(hashes.sort());
  });

  it('replaces a damaged live file when restoring over existing data', async () => {
    const file = await upload('the original water bill');
    const backup = join(dir, 'outside', 'manual.sqlite');
    await backupDatabase(live, backup);
    database.close();
    const path = documentFilePath(documents, file.sha256);
    rmSync(path); // a hard link shares its content with the backup: replace the file, do not write into it
    writeFileSync(path, 'x'.repeat(file.bytes)); // same size, other content
    restoreDatabase(backup, live);
    expect(readFileSync(path, 'utf8')).toBe('the original water bill');
    expect(readFileSync(documentFilePath(backupDocumentsPath(backup), file.sha256), 'utf8')).toBe('the original water bill');
    database = openDatabase(live);
  });

  it('verify fails for a missing or altered file, and restore then changes nothing', async () => {
    const file = await upload('the original water bill');
    const backup = join(dir, 'b', 'backup.sqlite');
    await backupDatabase(live, backup);
    const stored = documentFilePath(backupDocumentsPath(backup), file.sha256);
    rmSync(stored);
    writeFileSync(stored, 'the 0riginal water bill'); // same length, one character changed
    expect(() => verifyDatabase(backup)).toThrow(new BackupError('a document file of the backup is damaged'));
    expect(() => verifyDatabase(backup, { documents: 'present' })).not.toThrow(); // why `verify` reads every file
    writeFileSync(stored, 'shorter');
    expect(() => verifyDatabase(backup, { documents: 'present' })).toThrow(new BackupError('a document file of the backup is damaged'));
    rmSync(stored);
    expect(() => verifyDatabase(backup)).toThrow(new BackupError('a document file of the backup is missing'));
    const target = join(dir, 'fresh', 'x.sqlite');
    expect(() => restoreDatabase(backup, target)).toThrow(BackupError);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a backup when a file is damaged or missing; drops expired uploads whose file is gone and re-queues lost previews', async () => {
    const damaged = await upload('damaged later');
    const path = documentFilePath(documents, damaged.sha256);
    rmSync(path);
    writeFileSync(path, 'damaged l4ter');
    const refused = join(dir, 'a', 'refused.sqlite');
    await expect(backupDatabase(live, refused)).rejects.toThrow(new BackupError('a document file is damaged'));
    expect(existsSync(refused)).toBe(false);
    rmSync(path);
    await expect(backupDatabase(live, join(dir, 'a', 'missing.sqlite'))).rejects.toThrow(new BackupError('a document file is missing'));

    // A day later the upload is past its grace period: housekeeping may have removed its file just
    // after the snapshot. The backup then leaves the row out instead of failing.
    const kept = await upload('kept');
    const preview = database.sqlite.prepare("SELECT sha256 FROM document_file_derivatives WHERE file_id = ? AND kind = 'PREVIEW'").get(kept.id) as { sha256: string };
    rmSync(documentFilePath(documents, preview.sha256)); // a derived file is no loss
    const later = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 60_000);
    database.sqlite.prepare('DROP TRIGGER document_files_immutable').run(); // test only: make `kept` look newly uploaded
    database.sqlite.prepare('UPDATE document_files SET created_at = ? WHERE id = ?').run(later.getTime(), kept.id);
    const ok = join(dir, 'b', 'ok.sqlite');
    await backupDatabase(live, ok, { now: later });
    const sqlite = new Database(ok, { readonly: true });
    try {
      expect(sqlite.prepare('SELECT id, preview_state FROM document_files').all()).toEqual([{ id: kept.id, preview_state: 'PENDING' }]);
      expect(sqlite.prepare("SELECT count(*) AS n FROM document_file_derivatives WHERE kind = 'PREVIEW'").get()).toEqual({ n: 0 });
    } finally {
      sqlite.close();
    }
    expect(verifyDatabase(ok).migrationsPending).toBe(false);
  });

  it('shares files between scheduled backups and prunes them with the last backup that needs them', async () => {
    const temporary = await upload('never part of a document');
    const start = now.getTime();
    const at = (hours: number) => new Date(start + hours * 3_600_000);
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(0) });
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(1) });
    const stored = documentFilePath(join(dir, 'data', 'backups', 'documents'), temporary.sha256);
    expect(existsSync(stored)).toBe(true);
    // The upload was never used: housekeeping removes it from the live data — the backups keep it.
    now = at(30);
    expect((await purgeUnusedDocumentFiles(deps)).files).toBe(3);
    expect(existsSync(documentFilePath(documents, temporary.sha256))).toBe(false);
    expect(readFileSync(stored, 'utf8')).toBe('never part of a document');
    utimesSync(stored, at(1), at(1));
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(31) });
    expect(existsSync(stored)).toBe(true); // the backup of 1:00 still needs it
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(33) });
    expect(listAutomaticBackups(live)).toHaveLength(2);
    expect(existsSync(stored)).toBe(false); // gone with the last backup that referenced it
  });
});
