import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES, normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { createPreferencesRepository } from './preferences-repository.ts';

it('0057 preserves existing preferences, defaults order to null and refuses a disabled owner at write time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-0057-')); const path = join(dir, 'db.sqlite'); const before = join(dir, 'migrations');
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter(entry => entry.tag < '0057'); writeFileSync(journalPath, JSON.stringify(journal));
  let database = openDatabase(path);
  try {
    migrate(database.db, { migrationsFolder: before });
    const user = await createUserRepository(database).create({ email: normalizeEmail('upgrade57@example.org'), displayName: 'Upgrade', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    database.sqlite.prepare("INSERT INTO user_preferences(user_id,theme,critical_confirm,updated_at) VALUES(?,'dark','tap-confirm',123)").run(user.id);
    database.close(); runMigrations(path); database = openDatabase(path);
    expect(database.sqlite.prepare('SELECT * FROM user_preferences').get()).toEqual({ user_id: user.id, theme: 'dark', critical_confirm: 'tap-confirm', navigation_order: null, private_gamification: 1, guide: JSON.stringify(DEFAULT_GUIDE_PREFERENCES), updated_at: 123 });
    const repository = createPreferencesRepository(database);
    await repository.save(user.id, { guide: DEFAULT_GUIDE_PREFERENCES, theme: 'dark', criticalConfirm: 'tap-confirm', privateGamification: true, navigationOrder: ['EQUIPMENT', 'LISTS'] }, new Date(456));
    database.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(user.id);
    await expect(repository.save(user.id, { guide: DEFAULT_GUIDE_PREFERENCES, theme: 'light', criticalConfirm: 'hold', privateGamification: true, navigationOrder: ['PROCEDURES'] }, new Date())).rejects.toThrow();
    expect((await repository.find(user.id))?.navigationOrder).toEqual(['EQUIPMENT', 'LISTS']);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }); }
});
