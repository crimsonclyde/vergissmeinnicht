import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { migrationStatus } from './migrate.ts';
import { createTestDatabase } from './test-support.ts';

it('schema-template fixtures keep data, schema, WAL and permissions isolated', () => {
  const first = createTestDatabase();
  const second = createTestDatabase();
  try {
    first.sqlite.exec('CREATE TABLE fixture_probe (value TEXT); INSERT INTO fixture_probe VALUES (\'private\')');
    expect(second.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_probe'").get()).toBeUndefined();
    expect(second.sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(migrationStatus(second.sqlite).pending).toBe(false);
    expect(second.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(second.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(second.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(second.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(statSync(second.path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(second.path)).mode & 0o777).toBe(0o700);
    expect(() => second.sqlite.prepare("INSERT INTO memberships VALUES ('missing', 'missing', 'USER', 1, 1)").run()).toThrow(/FOREIGN KEY/);
  } finally {
    first.dispose();
    second.dispose();
  }
  const third = createTestDatabase();
  try {
    expect(third.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_probe'").get()).toBeUndefined();
  } finally { third.dispose(); }
});
