import { existsSync, readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { documentSearchText, documentTagKeys, documentTitleKey } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

/**
 * Fills the search columns of Documents that have none (rows from before migration 0029): folding
 * text — removing accents and case — is the domain's rule and cannot be written in SQL. Idempotent;
 * returns how many Documents were filled.
 */
export function fillDocumentSearch(sqlite: Database.Database): number {
  const rows = sqlite.prepare('SELECT id, title, notes, tags FROM documents WHERE title_key IS NULL OR tag_keys IS NULL OR search_text IS NULL').all() as { id: string; title: string; notes: string; tags: string }[];
  const fill = sqlite.prepare('UPDATE documents SET title_key = ?, tag_keys = ?, search_text = ? WHERE id = ?');
  sqlite.transaction(() => {
    for (const row of rows) {
      const tags = JSON.parse(row.tags) as string[];
      fill.run(documentTitleKey(row.title), JSON.stringify(documentTagKeys(tags)), documentSearchText({ title: row.title, notes: row.notes, tags }), row.id);
    }
  })();
  return rows.length;
}

export function runMigrations(databasePath: string): 'applied' | 'none' {
  if (!existsSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'))) {
    return 'none';
  }
  const { db, sqlite, close } = openDatabase(databasePath);
  try {
    // SQLite's table-rebuild procedure (e.g. migration 0019) needs foreign keys off while tables are
    // swapped; the pragma is a no-op inside the migrator's transaction, so it is set around it.
    sqlite.pragma('foreign_keys = OFF');
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');
    fillDocumentSearch(sqlite);
    if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
      throw new Error('Migration left foreign key violations; restore the pre-migration backup');
    }
    if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('Migration left the database inconsistent; restore the pre-migration backup');
    }
  } finally {
    close();
  }
  return 'applied';
}

/**
 * Whether every migration shipped with this version is applied. Like drizzle's migrator, it compares
 * the newest applied migration's timestamp with the newest one in the journal.
 */
export function migrationStatus(sqlite: Database.Database): { readonly pending: boolean } {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: { when: number }[];
  };
  const newestShipped = Math.max(0, ...journal.entries.map((entry) => entry.when));
  const table = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  const newestApplied =
    table === undefined ? 0 : ((sqlite.prepare('SELECT max(created_at) AS at FROM __drizzle_migrations').get() as { at: number | null }).at ?? 0);
  return { pending: newestApplied < newestShipped };
}

if (import.meta.main) {
  // Relative paths resolve against the repository root, matching the server configuration.
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const databasePath = resolve(repoRoot, process.env.DATABASE_PATH ?? '.var/vergissmeinnicht.sqlite');
  const result = runMigrations(databasePath);
  console.log(result === 'none' ? 'No migrations to apply yet.' : 'Migrations applied.');
}
