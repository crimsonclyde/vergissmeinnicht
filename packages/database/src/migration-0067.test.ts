import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';

it('0067 lets a guide card style be any of the five bundled backgrounds and still refuses anything else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0067-'));
  const path = join(dir, 'db.sqlite');
  const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < '0067');
  writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const users = createUserRepository(database);
    const person = await users.create({ email: normalizeEmail('guide@example.org'), displayName: 'Guide', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    const guide = '{"layout":"guide","cardStyle":"starfield","cardOpacity":50,"images":true}';
    database.sqlite.prepare("INSERT INTO user_preferences (user_id, theme, critical_confirm, guide, private_gamification, navigation_order, updated_at) VALUES (?, 'system', 'hold', ?, 1, NULL, 1)").run(person.id, guide);
    database.close();

    runMigrations(path);
    database = openDatabase(path);
    // Existing rows are carried over unchanged.
    expect(database.sqlite.prepare('SELECT guide FROM user_preferences WHERE user_id = ?').get(person.id)).toEqual({ guide });
    const update = database.sqlite.prepare('UPDATE user_preferences SET guide = ? WHERE user_id = ?');
    for (const cardStyle of ['glass', 'starfield', 'forest', 'water', 'hearth']) {
      expect(() => update.run(`{"layout":"guide","cardStyle":"${cardStyle}","cardOpacity":50,"images":true}`, person.id)).not.toThrow();
    }
    for (const cardStyle of ['url(https://bad.test)', 'Forest', 'witch-forest']) {
      expect(() => update.run(`{"layout":"guide","cardStyle":"${cardStyle}","cardOpacity":50,"images":true}`, person.id)).toThrow(/CHECK constraint failed/);
    }
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
