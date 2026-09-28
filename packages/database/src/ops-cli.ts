import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { BackupError, backupDatabase, defaultBackupPath, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { purgeExpired } from './housekeeping.ts';
import { migrationStatus, runMigrations } from './migrate.ts';

/**
 * Operator commands for the database (Steps 10.1/10.2). DATABASE_PATH selects the database
 * (relative paths resolve against the repository root, like the server's configuration).
 *
 *   migrate          back up (if migrations are pending), then apply migrations
 *   backup [--out]   consistent online backup, verified
 *   verify <file>    check a backup
 *   restore <file>   replace the database with a backup (server stopped; --force to override the check)
 *   housekeeping     delete expired sessions, challenges, finished links and rate-limit windows now
 */
const USAGE = 'Usage: ops-cli.ts migrate | backup [--out <file>] | verify <file> | restore <file> [--force] | housekeeping';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, force: { type: 'boolean', default: false } },
});
const repoRoot = resolve(import.meta.dirname, '../../..');
const databasePath = resolve(repoRoot, process.env.DATABASE_PATH ?? '.var/vergissmeinnicht.sqlite');
const [command, file] = positionals;

function pending(): boolean {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return migrationStatus(sqlite).pending;
  } finally {
    sqlite.close();
  }
}

try {
  switch (command) {
    case 'migrate': {
      if (existsSync(databasePath) && pending()) {
        const target = defaultBackupPath(databasePath).replace(/\.sqlite$/, '-pre-migration.sqlite');
        await backupDatabase(databasePath, target);
        console.log(`Backup before migrating: ${target}`);
      }
      runMigrations(databasePath);
      console.log('Migrations applied; the database is up to date.');
      break;
    }
    case 'backup': {
      const target = resolve(values.out ?? defaultBackupPath(databasePath));
      const { bytes } = await backupDatabase(databasePath, target);
      console.log(`Backup written and verified: ${target} (${bytes} bytes). Protect it like the live database.`);
      break;
    }
    case 'verify': {
      if (file === undefined) throw new BackupError(USAGE);
      const { migrationsPending } = verifyDatabase(resolve(file));
      console.log(`Backup OK${migrationsPending ? ' (older schema: run "migrate" after restoring)' : ''}.`);
      break;
    }
    case 'restore': {
      if (file === undefined) throw new BackupError(USAGE);
      const { previous, migrationsPending } = restoreDatabase(resolve(file), databasePath, { force: values.force });
      console.log(`Restored ${databasePath}.${previous === null ? '' : ` The replaced database was kept as ${previous}.`}`);
      if (migrationsPending) console.log('The backup has an older schema: run "migrate" before starting the server.');
      break;
    }
    case 'housekeeping': {
      const database = openDatabase(databasePath);
      try {
        const deleted = purgeExpired(database);
        console.log(`Deleted: ${Object.entries(deleted).map(([table, count]) => `${table} ${count}`).join(', ')}.`);
      } finally {
        database.close();
      }
      break;
    }
    default:
      console.error(USAGE);
      process.exit(2);
  }
} catch (error) {
  if (error instanceof BackupError) {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
