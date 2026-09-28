import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './connection.ts';

describe('openDatabase', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('enables foreign keys and WAL with restrictive file permissions', () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-db-'));
    const path = join(dir, 'nested', 'test.sqlite');
    const { sqlite, close } = openDatabase(path);
    try {
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
    } finally {
      close();
    }
  });

  it('rejects rows violating a foreign key', () => {
    const { sqlite, close } = openDatabase(':memory:');
    try {
      sqlite.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)');
      sqlite.exec('CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id))');
      expect(() => sqlite.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'missing')).toThrow(/FOREIGN KEY/);
    } finally {
      close();
    }
  });
});
