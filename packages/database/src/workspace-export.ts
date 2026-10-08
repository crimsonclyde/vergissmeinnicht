import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { documentFilePath, mediaFilePath } from './backup.ts';
import type { AppDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER } from './migrate.ts';
import { EXPORTED_TABLES, type ExportedTable } from './workspace-backup-tables.ts';

/** One entry of the package, prepared in the staging folder. `sha256` is known for data entries; a file's name is its hash. */
export interface StagedEntry {
  /** Path inside the package (`data/procedures.ndjson`, `files/documents/<sha256>`). */
  readonly path: string;
  /** Where it is staged on disk. */
  readonly source: string;
  readonly size: number;
  /** Data entries: computed while writing. Files: the name — re-checked while archiving. */
  readonly sha256: string;
  readonly kind: 'data' | 'file';
}

export interface WorkspaceSnapshot {
  readonly workspaceName: string;
  /** The schema level the rows were written with: the last migration applied to this database. */
  readonly databaseLevel: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly entries: readonly StagedEntry[];
}

export class WorkspaceExportError extends Error {
  readonly code: 'workspace_not_found' | 'missing_file';
  constructor(code: 'workspace_not_found' | 'missing_file') {
    super(`Workspace export: ${code}`);
    this.name = 'WorkspaceExportError';
    this.code = code;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
/** Lines are written in chunks of about this size: memory stays bounded whatever the table size. */
const CHUNK = 256 * 1024;

/** The last migration applied to this database, by the migration journal (e.g. `0044_workspace_backup_jobs`). */
export function databaseLevel(sqlite: AppDatabase['sqlite']): string {
  const applied = (sqlite.prepare('SELECT max(created_at) AS at FROM __drizzle_migrations').get() as { at: number | null }).at;
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { when: number; tag: string }[] };
  return journal.entries.find((entry) => entry.when === applied)?.tag ?? 'unknown';
}

class NdjsonWriter {
  private readonly fd: number;
  private readonly hash = createHash('sha256');
  private buffer = '';
  size = 0;
  rows = 0;
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    this.fd = openSync(path, 'wx', 0o600);
  }
  write(row: object): void {
    this.buffer += `${JSON.stringify(row)}\n`;
    this.rows += 1;
    if (this.buffer.length >= CHUNK) this.flush();
  }
  private flush(): void {
    if (this.buffer === '') return;
    const bytes = Buffer.from(this.buffer, 'utf8');
    this.hash.update(bytes);
    writeSync(this.fd, bytes);
    this.size += bytes.length;
    this.buffer = '';
  }
  close(): string {
    this.flush();
    fsyncSync(this.fd);
    closeSync(this.fd);
    return this.hash.digest('hex');
  }
}

/** A hard link costs no space and no copying (as the server backup does); across file systems the file is copied. */
function linkOrCopy(source: string, target: string): void {
  try {
    linkSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    copyFileSync(source, target);
  }
}

/**
 * Writes one Workspace into `stagingDir` (section 18a) from **one read transaction**, so every
 * relationship is coherent: `data/<table>.ndjson` per exported table (allowlist), `persons.ndjson`, and the
 * referenced original files hard-linked under `files/` — inside the same snapshot, so a permanent
 * deletion during a long export cannot remove a file the rows still name. User ids never leave: every
 * user column becomes a person reference (`person-1`, …); members' name, role and email are in
 * `persons.ndjson`/`memberships.ndjson` (B3), other people only by the name the server shows for them.
 */
export function snapshotWorkspace(
  database: Pick<AppDatabase, 'sqlite'>,
  input: { readonly workspaceId: string; readonly stagingDir: string; readonly documentsPath: string; readonly mediaPath: string; readonly isCancelled?: () => boolean },
): WorkspaceSnapshot {
  const { sqlite } = database;
  mkdirSync(join(input.stagingDir, 'data'), { recursive: true, mode: 0o700 });
  mkdirSync(join(input.stagingDir, 'files', 'documents'), { recursive: true, mode: 0o700 });
  mkdirSync(join(input.stagingDir, 'files', 'images'), { recursive: true, mode: 0o700 });

  const run = sqlite.transaction((): WorkspaceSnapshot => {
    const workspace = sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get(input.workspaceId) as { name: string } | undefined;
    if (workspace === undefined) throw new WorkspaceExportError('workspace_not_found');
    const persons = new Map<string, string>();
    const person = (userId: unknown): string | null => {
      if (typeof userId !== 'string') return null;
      let ref = persons.get(userId);
      if (ref === undefined) {
        ref = `person-${persons.size + 1}`;
        persons.set(userId, ref);
      }
      return ref;
    };
    const entries: StagedEntry[] = [];
    const counts: Record<string, number> = {};
    const files = new Set<string>();
    const memberUserIds = new Set<string>();

    for (const spec of EXPORTED_TABLES) {
      if (input.isCancelled?.() === true) throw new Error('cancelled');
      const writer = new NdjsonWriter(join(input.stagingDir, 'data', `${spec.name}.ndjson`));
      const parameters = Array.from({ length: (spec.from.match(/\?/g) ?? []).length }, () => input.workspaceId);
      for (const raw of sqlite.prepare(spec.select).iterate(...parameters) as Iterable<Record<string, unknown>>) {
        writer.write(transform(spec, raw, person, input.workspaceId));
        if (spec.table === 'memberships' && typeof raw.user_id === 'string') memberUserIds.add(raw.user_id);
        if (spec.fileStore !== undefined) {
          const sha = raw.sha256;
          if (typeof sha !== 'string' || !SHA256.test(sha)) throw new WorkspaceExportError('missing_file');
          const key = `${spec.fileStore}/${sha}`;
          if (!files.has(key)) {
            files.add(key);
            const source = spec.fileStore === 'documents' ? documentFilePath(input.documentsPath, sha) : mediaFilePath(input.mediaPath, sha);
            if (!existsSync(source)) throw new WorkspaceExportError('missing_file');
            const target = join(input.stagingDir, 'files', spec.fileStore, sha);
            linkOrCopy(source, target);
            entries.push({ path: `files/${key}`, source: target, size: statSync(target).size, sha256: sha, kind: 'file' });
          }
        }
      }
      const sha256 = writer.close();
      counts[spec.name] = writer.rows;
      entries.push({ path: `data/${spec.name}.ndjson`, source: writer.path, size: writer.size, sha256, kind: 'data' });
    }

    // People: the name the server shows for each, and — for members only — their email address (B3).
    const people = new NdjsonWriter(join(input.stagingDir, 'data', 'persons.ndjson'));
    const lookup = sqlite.prepare('SELECT display_name, email FROM users WHERE id = ?');
    for (const [userId, ref] of persons) {
      const user = lookup.get(userId) as { display_name: string; email: string } | undefined;
      people.write({ ref, displayName: user?.display_name ?? '', email: memberUserIds.has(userId) && user !== undefined ? user.email : null });
    }
    const personsSha = people.close();
    counts.persons = people.rows;
    entries.unshift({ path: 'data/persons.ndjson', source: people.path, size: people.size, sha256: personsSha, kind: 'data' });
    return { workspaceName: workspace.name, databaseLevel: databaseLevel(sqlite), counts, entries };
  });
  return run.deferred();
}

/** Where the source Workspace's own id appeared (e.g. an audit entry about the Workspace): the restore puts the new one there. */
export const WORKSPACE_REFERENCE = '@workspace';

/**
 * A row as it goes into the package: no Workspace id column (implicit), user ids as person references,
 * omitted columns left out, and the Workspace's own id — wherever it appears, also inside JSON text such
 * as audit metadata — replaced by `@workspace`. Nothing server-specific identifies the source.
 */
function transform(spec: ExportedTable, raw: Record<string, unknown>, person: (userId: unknown) => string | null, workspaceId: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(raw)) {
    if (column === 'workspace_id' || spec.omit.includes(column)) continue;
    if (spec.userColumns.includes(column)) row[column] = person(value);
    else if (value instanceof Uint8Array) throw new Error(`binary column ${spec.table}.${column} is not supported`);
    else row[column] = typeof value === 'string' ? value.replaceAll(workspaceId, WORKSPACE_REFERENCE) : value;
  }
  return row;
}
