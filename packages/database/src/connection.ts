import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type AppDatabase = ReturnType<typeof openDatabase>;

/**
 * Opens the SQLite database with the pragmas the project relies on.
 * The DB file and its WAL/SHM sidecars contain sensitive data, so the
 * directory and file are restricted to the owning user.
 */
export function openDatabase(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path);
  if (path !== ':memory:') {
    chmodSync(path, 0o600);
  }
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle({ client: sqlite, schema });
  return { db, sqlite, close: () => sqlite.close() };
}
