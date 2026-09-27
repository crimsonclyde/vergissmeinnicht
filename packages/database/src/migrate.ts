import { existsSync, readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from './connection.ts';

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../migrations');

export function runMigrations(databasePath: string): 'applied' | 'none' {
  if (!existsSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'))) {
    return 'none';
  }
  const { db, close } = openDatabase(databasePath);
  try {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
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
