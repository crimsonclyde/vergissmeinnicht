import { existsSync } from 'node:fs';
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

if (import.meta.main) {
  // Relative paths resolve against the repository root, matching the server configuration.
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const databasePath = resolve(repoRoot, process.env.DATABASE_PATH ?? '.var/vergissmeinnicht.sqlite');
  const result = runMigrations(databasePath);
  console.log(result === 'none' ? 'No migrations to apply yet.' : 'Migrations applied.');
}
