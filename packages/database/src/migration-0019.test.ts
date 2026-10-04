import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProcedure,
  type ProcedureInput,
} from '@vergissmeinnicht/application';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { insertLegacyProcedure, insertLegacyRun, insertLegacyWorkspace } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: 'Before a trip',
  icon: 'travel',
  tags: ['daily'],
  sections: [
    {
      title: 'Kitchen',
      description: '',
      steps: [
        { title: 'Stove off', description: '', icon: 'kitchen', required: true, critical: true, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'OPTIONAL' },
        { title: 'Windows', description: '', icon: null, required: false, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' },
      ],
    },
  ],
};

const TABLES = ['procedures', 'procedure_sections', 'procedure_steps', 'runs', 'run_sections', 'run_steps', 'audit_events'];

describe('migration 0019: icons as a reference table (table rebuild)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-0019-'));
    path = join(dir, 'db.sqlite');
    // The migrations up to 0018, i.e. the schema before this change.
    const before = join(dir, 'migrations');
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    // 0019 and every later migration are applied by the test itself.
    const journal = JSON.parse(readFileSync(join(before, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.tag >= '0019')) rmSync(join(before, `${entry.tag}.sql`));
    journal.entries = journal.entries.filter((entry) => entry.tag < '0019');
    writeFileSync(join(before, 'meta', '_journal.json'), JSON.stringify(journal));
    const database = openDatabase(path);
    migrate(database.db, { migrationsFolder: before });
    database.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps every row, index and trigger, keeps finished Runs frozen and accepts only known icons', async () => {
    let database = openDatabase(path);
    const clock = { now: () => new Date() };
    const users = createUserRepository(database);
    const admin = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    const home = insertLegacyWorkspace(database, { name: 'Home', adminUserId: admin.id });
    // Plain SQL: today's repositories name columns this old schema does not have yet.
    const procedure = {
      procedure: insertLegacyProcedure(database, {
        workspaceId: home.id,
        userId: admin.id,
        title: 'Leave the house',
        icon: 'travel',
        steps: [{ title: 'Stove off', icon: 'kitchen', critical: true }, { title: 'Windows' }],
      }),
    };
    // Runs in plain SQL: today's repositories name columns this old schema does not have yet.
    const finished = { run: { id: insertLegacyRun(database, { workspaceId: home.id, procedureId: procedure.procedure.id, user: { id: admin.id, displayName: admin.displayName }, state: 'COMPLETED' }).runId } };
    const active = { run: { id: insertLegacyRun(database, { workspaceId: home.id, procedureId: procedure.procedure.id, user: { id: admin.id, displayName: admin.displayName } }).runId } };

    // Only the columns that exist now: later migrations may add columns (e.g. 0025 images).
    const columns = Object.fromEntries(
      TABLES.map((table) => [table, (database.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => `"${column.name}"`).join(', ')]),
    );
    const snapshot = () =>
      Object.fromEntries(TABLES.map((table) => [table, database.sqlite.prepare(`SELECT ${columns[table]} FROM ${table} ORDER BY rowid`).all()]));
    const schemaObjects = () =>
      database.sqlite
        .prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name")
        .all();
    const before = snapshot();
    const objectsBefore = schemaObjects();
    database.close();

    runMigrations(path);

    database = openDatabase(path);
    expect(snapshot()).toEqual(before);
    // Every index and trigger is back unchanged (later migrations only add objects).
    expect(schemaObjects()).toEqual(expect.arrayContaining(objectsBefore));
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM procedure_icons').get() as { n: number }).n).toBeGreaterThanOrEqual(60);

    // The immutability triggers are back and still hold.
    expect(() => database.sqlite.prepare('UPDATE runs SET title = ? WHERE id = ?').run('changed', finished.run.id)).toThrow(/run is finished|snapshot is immutable/);
    expect(() => database.sqlite.prepare('DELETE FROM runs WHERE id = ?').run(active.run.id)).toThrow(/never deleted/);
    expect(() => database.sqlite.prepare("UPDATE run_steps SET state = 'PENDING' WHERE run_id = ?").run(finished.run.id)).toThrow(/not active/);
    expect(() => database.sqlite.prepare("UPDATE run_steps SET icon = 'power' WHERE run_id = ?").run(active.run.id)).toThrow(/immutable/);

    // New icons work through the normal path; unknown keys are refused by the database.
    const next = await createProcedure(
      { workspaces: createWorkspaceRepository(database), procedures: createProcedureRepository(database), clock },
      { actor: admin, workspaceId: home.id, content: { ...PROCEDURE, title: 'Offboarding', icon: 'offboarding' } },
    );
    expect(next.procedure.icon).toBe('offboarding');
    expect(() => database.sqlite.prepare("UPDATE procedures SET icon = 'unknown' WHERE id = ?").run(next.procedure.id)).toThrow(/FOREIGN KEY/);
    expect(() => database.sqlite.prepare("UPDATE procedure_steps SET icon = 'unknown' WHERE procedure_id = ?").run(next.procedure.id)).toThrow(/FOREIGN KEY/);
    database.close();

    // Running the migrations again changes nothing.
    runMigrations(path);
  });
});
