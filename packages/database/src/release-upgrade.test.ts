import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { createDocumentFileProcessor, createDocumentFileStore } from '@vergissmeinnicht/media';
import { backupDatabase, defaultDocumentsPath, documentFilePath, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyProcedure, insertLegacyRun, insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

it('upgrades a populated beta.2 database and restores its verified backup with original files and history intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-release-upgrade-'));
  const path = join(dir, 'data', 'db.sqlite');
  const before = join(dir, 'old-migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0035');
  expect(journal.entries).toHaveLength(35); // Released v0.5.0-beta.2 schema, not the template helper.
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  const processor = createDocumentFileProcessor();
  try {
    migrate(database.db, { migrationsFolder: before });
    const user = await createUserRepository(database).create({ email: normalizeEmail('upgrade@example.org'), displayName: 'Fictional upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const home = insertLegacyWorkspace(database, { name: 'Upgrade household', adminUserId: user.id });
    database.sqlite.prepare("INSERT INTO workspace_tools VALUES (?, 'DOCUMENTS', 1, 1, ?), (?, 'CONTACTS', 0, 1, ?)").run(home.id, user.id, home.id, user.id);
    const procedure = insertLegacyProcedure(database, { workspaceId: home.id, userId: user.id, title: 'Historical procedure', steps: [{ title: 'Checked' }] });
    insertLegacyRun(database, { workspaceId: home.id, procedureId: procedure.id, user, state: 'COMPLETED' });
    const store = createDocumentFileStore(defaultDocumentsPath(path));
    const original = readFileSync(join(import.meta.dirname, '../../media/src/fixtures/three-pages.pdf'));
    // The file as beta.2 stored it: today's upload code also writes tables of later migrations (0038).
    const staged = await store.stage((async function* () { yield original; })(), 50_000_000);
    await staged.commit();
    const upload = { file: { id: randomUUID(), sha256: staged.sha256 } };
    database.sqlite
      .prepare("INSERT INTO document_files (id, workspace_id, sha256, bytes, format, original_name, page_count, encrypted, active_content, preview_state, preview_attempts, uploaded_by_user_id, uploaded_by_display_name, created_at) VALUES (?, ?, ?, ?, 'PDF', 'fictional.pdf', 3, 0, 0, 'NONE', 0, ?, 'Fictional upgrade', ?)")
      .run(upload.file.id, home.id, staged.sha256, staged.bytes, user.id, Date.now());
    // … and the Document as beta.2 wrote it (title, folded search columns, its one page).
    const documentId = randomUUID();
    const at = Date.now();
    database.sqlite
      .prepare("INSERT INTO documents (id, workspace_id, title, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at, title_key, tag_keys, search_text) VALUES (?, ?, 'Fictional bill', ?, 'Fictional upgrade', ?, ?, 'Fictional upgrade', ?, 'fictional bill', '[]', 'fictional bill')")
      .run(documentId, home.id, user.id, at, user.id, at);
    database.sqlite.prepare('INSERT INTO document_pages (document_id, workspace_id, position, file_id) VALUES (?, ?, 0, ?)').run(documentId, home.id, upload.file.id);
    const tables = ['users', 'memberships', 'procedures', 'procedure_sections', 'procedure_steps', 'runs', 'run_sections', 'run_steps', 'documents', 'document_pages', 'document_files', 'document_file_derivatives', 'audit_events'];
    const snapshot = () => tables.map((table) => database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const expected = snapshot();
    const backup = join(dir, 'backups', 'before-upgrade.sqlite');
    await backupDatabase(path, backup);
    expect(verifyDatabase(backup).migrationsPending).toBe(true);
    database.close();
    runMigrations(path);
    database = openDatabase(path);
    expect(snapshot()).toEqual(expected);
    // P5: recognition is on after the upgrade, and the existing file waits behind new uploads.
    expect(database.sqlite.prepare('SELECT state, priority, attempts FROM document_file_texts WHERE file_id = ?').get(upload.file.id)).toEqual({ state: 'QUEUED', priority: 1, attempts: 0 });
    expect(database.sqlite.prepare('SELECT text_recognition FROM workspaces WHERE id = ?').get(home.id)).toEqual({ text_recognition: 1 });
    expect(await createWorkspaceRepository(database).enabledTools(home.id)).toEqual(['CALENDAR', 'DOCUMENTS', 'LISTS', 'PROCEDURES', 'REMINDERS']);
    expect(verifyDatabase(path).migrationsPending).toBe(false);
    expect(readFileSync(documentFilePath(defaultDocumentsPath(path), upload.file.sha256))).toEqual(original);
    database.close();
    const restored = join(dir, 'restored', 'db.sqlite');
    expect(restoreDatabase(backup, restored).migrationsPending).toBe(true);
    runMigrations(restored);
    database = openDatabase(restored);
    expect(snapshot()).toEqual(expected);
    expect(readFileSync(documentFilePath(defaultDocumentsPath(restored), upload.file.sha256))).toEqual(original);
    expect(verifyDatabase(restored).migrationsPending).toBe(false);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    await processor.close();
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
