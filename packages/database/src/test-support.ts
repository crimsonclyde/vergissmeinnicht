import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceId } from '@vergissmeinnicht/domain';
import { openDatabase, type AppDatabase } from './connection.ts';
import { workspaceTools } from './schema.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';
import { runMigrations } from './migrate.ts';

let emptyDatabase: Buffer | undefined;

/** Migrate once per isolated test module; only the closed, empty database bytes are reused. */
function migratedTemplate(): Buffer {
  if (emptyDatabase !== undefined) return emptyDatabase;
  const dir = mkdtempSync(join(tmpdir(), 'vmn-test-schema-'));
  const path = join(dir, 'empty.sqlite');
  try {
    runMigrations(path); // Real migrations and integrity checks; last connection closes/checkpoints WAL.
    emptyDatabase = readFileSync(path);
    return emptyDatabase;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fresh, independently writable, fully migrated database. Production settings stay unchanged. */
export function createTestDatabase(): AppDatabase & { readonly path: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-test-'));
  const path = join(dir, 'test.sqlite');
  writeFileSync(path, migratedTemplate(), { mode: 0o600 });
  const database = openDatabase(path);
  return {
    ...database,
    path,
    dispose() {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A Workspace with its first ADMIN, written in plain SQL: for migration tests that build data on an
 * older schema, where today's repositories would name columns that do not exist yet.
 */
export function insertLegacyWorkspace(database: Pick<AppDatabase, 'sqlite'>, input: { readonly name: string; readonly adminUserId: string }): { id: WorkspaceId; name: string } {
  const id = randomUUID() as WorkspaceId;
  const now = Date.now();
  database.sqlite.prepare('INSERT INTO workspaces (id, name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, input.name, input.adminUserId, now, now);
  database.sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'ADMIN', ?, ?)").run(id, input.adminUserId, now, now);
  return { id, name: input.name };
}

/**
 * A Run snapshot of a Procedure, written in plain SQL with only the columns every schema since 0011
 * has (for migration tests on older schemas). `COMPLETED` marks every Step DONE first.
 */
export function insertLegacyRun(
  database: Pick<AppDatabase, 'sqlite'>,
  input: { readonly workspaceId: string; readonly procedureId: string; readonly user: { readonly id: string; readonly displayName: string }; readonly state?: 'ACTIVE' | 'COMPLETED' | 'ABORTED'; readonly at?: number },
): { readonly runId: string } {
  const { sqlite } = database;
  const at = input.at ?? Date.now();
  const runId = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO runs (id, workspace_id, procedure_id, procedure_revision, title, description, icon, tags, state, revision, started_by_user_id, started_by_display_name, started_at)
       SELECT ?, workspace_id, id, revision, title, description, icon, tags, 'ACTIVE', 1, ?, ?, ? FROM procedures WHERE id = ? AND workspace_id = ?`,
    )
    .run(runId, input.user.id, input.user.displayName, at, input.procedureId, input.workspaceId);
  const sections = sqlite.prepare('SELECT id, position, title, description FROM procedure_sections WHERE procedure_id = ? ORDER BY position').all(input.procedureId) as {
    id: string;
    position: number;
    title: string;
    description: string;
  }[];
  for (const section of sections) {
    const runSectionId = randomUUID();
    sqlite.prepare('INSERT INTO run_sections (id, run_id, position, source_section_id, title, description) VALUES (?, ?, ?, ?, ?, ?)').run(runSectionId, runId, section.position, section.id, section.title, section.description);
    sqlite
      .prepare(
        `INSERT INTO run_steps (id, run_id, run_section_id, position, source_step_id, kind, title, description, icon, required, critical, skip_reason_policy, not_applicable_reason_policy, state)
         SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
                ?, ?, position, id, kind, title, description, icon, required, critical, skip_reason_policy, not_applicable_reason_policy, 'PENDING'
         FROM procedure_steps WHERE section_id = ? ORDER BY position`,
      )
      .run(runId, runSectionId, section.id);
  }
  if (input.state === 'COMPLETED') {
    sqlite
      .prepare("UPDATE run_steps SET state = 'DONE', state_changed_by_user_id = ?, state_changed_by_display_name = ?, state_changed_at = ? WHERE run_id = ?")
      .run(input.user.id, input.user.displayName, at, runId);
  }
  if (input.state === 'COMPLETED' || input.state === 'ABORTED') {
    sqlite
      .prepare('UPDATE runs SET state = ?, revision = 2, ended_at = ?, ended_by_user_id = ?, ended_by_display_name = ?, end_reason = ? WHERE id = ?')
      .run(input.state, at, input.user.id, input.user.displayName, input.state === 'ABORTED' ? 'Aborted' : null, runId);
  }
  return { runId };
}

/** A Procedure with one Section of Steps, written in plain SQL (for migration tests on older schemas). */
export function insertLegacyProcedure(
  database: Pick<AppDatabase, 'sqlite'>,
  input: { readonly workspaceId: string; readonly userId: string; readonly title: string; readonly icon?: string; readonly steps: readonly { readonly title: string; readonly icon?: string | null; readonly critical?: boolean }[]; readonly deleted?: boolean },
): { readonly id: string } {
  const { sqlite } = database;
  const now = Date.now();
  const id = randomUUID();
  const sectionId = randomUUID();
  sqlite
    .prepare(
      "INSERT INTO procedures (id, workspace_id, title, description, icon, tags, revision, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, '[]', 1, ?, ?, ?)",
    )
    .run(id, input.workspaceId, input.title, input.icon ?? 'checklist', input.userId, now, now);
  sqlite.prepare("INSERT INTO procedure_sections (id, procedure_id, position, title, description) VALUES (?, ?, 0, 'Section', '')").run(sectionId, id);
  input.steps.forEach((step, position) => {
    sqlite
      .prepare(
        "INSERT INTO procedure_steps (id, procedure_id, section_id, position, kind, title, description, icon, required, critical, skip_reason_policy, not_applicable_reason_policy) VALUES (?, ?, ?, ?, 'CHECK', ?, '', ?, 1, ?, 'OPTIONAL', 'OPTIONAL')",
      )
      .run(randomUUID(), id, sectionId, position, step.title, step.icon ?? null, step.critical === true ? 1 : 0);
  });
  if (input.deleted === true) sqlite.prepare('UPDATE procedures SET deleted_at = ?, deleted_by_user_id = ?, revision = 2 WHERE id = ?').run(now, input.userId, id);
  return { id };
}

/** Existing feature suites use a configured Workspace; fresh-default tests use the real repository. */
export function createConfiguredWorkspaceRepository(database: Pick<AppDatabase, 'db'>) {
  const repository = createWorkspaceRepository(database);
  return {
    ...repository,
    async create(...args: Parameters<typeof repository.create>) {
      const workspace = await repository.create(...args);
      for (const tool of ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR'] as const) database.db.insert(workspaceTools).values({ workspaceId: workspace.id, tool, enabled: true, updatedAt: args[0].at, updatedByUserId: args[0].creatorId }).run();
      return workspace;
    },
  };
}

export function enableCoreTools(database: Pick<AppDatabase, 'sqlite'>, workspaceId: string, userId: string): void {
  const insert = database.sqlite.prepare('INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id) VALUES (?, ?, 1, ?, ?) ON CONFLICT (workspace_id, tool) DO UPDATE SET enabled = 1');
  for (const tool of ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR']) insert.run(workspaceId, tool, Date.now(), userId);
}
