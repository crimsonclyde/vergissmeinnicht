import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROCEDURE_ICONS } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { runMigrations } from './migrate.ts';

describe('procedure_icons', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('holds exactly the trusted icon keys after all migrations (a new key needs its INSERT migration)', () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-icons-'));
    const path = join(dir, 'icons.sqlite');
    runMigrations(path);
    const { sqlite, close } = openDatabase(path);
    try {
      const keys = (sqlite.prepare('SELECT key FROM procedure_icons').all() as { key: string }[]).map((row) => row.key);
      expect(keys.sort()).toEqual([...PROCEDURE_ICONS].sort());
    } finally {
      close();
    }
  });
});
