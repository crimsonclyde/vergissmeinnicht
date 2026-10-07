import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

it('0039 keeps every beta.6 text row and its queue state, starts without corrections and keeps text identity immutable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0039-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0039');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const user = await createUserRepository(database).create({ email: normalizeEmail('upgrade@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const workspace = insertLegacyWorkspace(database, { name: 'Old', adminUserId: user.id });
    const file = (n: number) => {
      const id = randomUUID();
      database.sqlite
        .prepare("INSERT INTO document_files (id, workspace_id, sha256, bytes, format, original_name, page_count, encrypted, active_content, preview_state, preview_attempts, uploaded_by_user_id, uploaded_by_display_name, created_at) VALUES (?, ?, ?, 10, 'JPEG', 'scan.jpg', 1, 0, 0, 'NONE', 0, ?, 'Upgrade', 1)")
        .run(id, workspace.id, n.toString(16).padStart(64, '0'), user.id);
      return id;
    };
    const done = file(1);
    const queued = file(2);
    database.sqlite.prepare("INSERT INTO document_file_texts (file_id, workspace_id, state, priority, attempts, source, text, search_text, bytes, pages, queued_at, updated_at) VALUES (?, ?, 'DONE', 0, 1, 'OCR', 'Bolletta acqua', 'bolletta acqua', 14, 1, 1, 2)").run(done, workspace.id);
    database.sqlite.prepare("INSERT INTO document_file_texts (file_id, workspace_id, state, priority, attempts, lease_until, error_code, queued_at, updated_at) VALUES (?, ?, 'QUEUED', 1, 2, 99, 'unreadable', 1, 2)").run(queued, workspace.id);
    const rows = database.sqlite.prepare('SELECT * FROM document_file_texts ORDER BY file_id').all();
    database.close();
    runMigrations(path);
    database = openDatabase(path);
    const after = database.sqlite.prepare('SELECT * FROM document_file_texts ORDER BY file_id').all() as Record<string, unknown>[];
    const added = { corrected_text: null, corrected_search_text: null, correction_bytes: 0, corrected_by_user_id: null, corrected_by_display_name: null, corrected_at: null, text_revision: 0 };
    expect(after).toEqual(rows.map((row) => ({ ...(row as object), ...added })));
    expect(() => database.sqlite.prepare('UPDATE document_file_texts SET workspace_id = ? WHERE file_id = ?').run(randomUUID(), done)).toThrow(/immutable/);
    // A correction must come with who and when.
    expect(() => database.sqlite.prepare("UPDATE document_file_texts SET corrected_text = 'x' WHERE file_id = ?").run(done)).toThrow(/CHECK/);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
