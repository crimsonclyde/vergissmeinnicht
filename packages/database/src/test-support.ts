import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type AppDatabase } from './connection.ts';
import { runMigrations } from './migrate.ts';

/** Fresh, fully migrated database in a temp directory. Test-only helper. */
export function createTestDatabase(): AppDatabase & { dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-test-'));
  const path = join(dir, 'test.sqlite');
  runMigrations(path);
  const database = openDatabase(path);
  return {
    ...database,
    dispose() {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
