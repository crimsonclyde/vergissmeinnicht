import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { contactKeys, documentSearchText, documentTagKeys, documentTitleKey, IMPORTED_EMAIL_DOMAIN, MAX_WORKSPACE_NAME_LENGTH, WORKSPACE_ROLES, type ContactPoint } from '@vergissmeinnicht/domain';
import { IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { storageUsageIn } from './storage-usage.ts';
import { EXPORTED_TABLES, type ExportedTable } from './workspace-backup-tables.ts';
import { MIGRATIONS_FOLDER } from './migrate.ts';
import { databaseLevel, WORKSPACE_REFERENCE } from './workspace-export.ts';

/**
 * Restoring a Workspace backup (section 18, 18b) — always into a new Workspace, in one IMMEDIATE transaction.
 *
 * Every package is hostile until proven otherwise. Each record is read from the extracted NDJSON with a bounded
 * line length; its columns must be exactly those this server exports for the table, its values plain JSON
 * scalars, and its JSON columns of the expected shape. Every record gets a new id; package ids only rebuild the
 * relationships inside the package: a reference must resolve to a record of the right table in the same package
 * (otherwise `broken_reference`), an id the package does not contain (an end deleted for good, a source Step of a
 * since-edited Procedure) becomes a fresh id that points nowhere — never an id of this server. People become
 * historical identities (status IMPORTED, `<id>@imported.invalid`), never matched to accounts. The database's
 * own constraints and triggers check every row again; only the four history triggers named in migration 0045 are
 * relaxed for this one Workspace by `workspace_restore_marks`, and exactly their references are checked here.
 *
 * Nothing that sends: no memberships but the restoring admin's, no reminders, every active Schedule PAUSED and
 * every assignment cleared. A check run (`commit: false`) performs the whole restore and rolls it back.
 */

/** The first database level that wrote Workspace backups (format 1). */
const FIRST_BACKUP_LEVEL = '0044_workspace_backup_jobs';

/**
 * Whether a package written at `level` can be restored here: a level this server knows, from the first one with
 * backups up to its own. A newer level is refused (this server cannot know its records). Every exported table has
 * had the same columns since 0044; a migration that changes one must add an upgrade of older packages here.
 */
export function isRestorableLevel(sqlite: AppDatabase['sqlite'], level: string): boolean {
  const tags = (JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }).entries.map((entry) => entry.tag);
  const index = tags.indexOf(level);
  return index !== -1 && index >= tags.indexOf(FIRST_BACKUP_LEVEL) && index <= tags.indexOf(databaseLevel(sqlite));
}

/** The record types a package carries: one per exported table, and the people. */
export const RESTORE_DATA_NAMES: ReadonlySet<string> = new Set(['persons', ...EXPORTED_TABLES.map((spec) => spec.name)]);

export type WorkspaceRestoreErrorCode = 'malformed_records' | 'broken_reference' | 'missing_file' | 'unexpected_file' | 'file_mismatch' | 'storage_limit' | 'forbidden';

/** The restore is refused. `table` names a record type of the allowlist (never content of the package). */
export class WorkspaceRestoreError extends Error {
  readonly code: WorkspaceRestoreErrorCode;
  readonly table: string | null;
  constructor(code: WorkspaceRestoreErrorCode, table: string | null = null) {
    super(`Workspace restore refused: ${code}${table === null ? '' : ` (${table})`}`);
    this.name = 'WorkspaceRestoreError';
    this.code = code;
    this.table = table;
  }
}

/** What the server found out about an original by inspecting its bytes — the package's own claims are not used. */
export interface RestoredDocumentFileFacts {
  readonly bytes: number;
  readonly format: string;
  readonly pageCount: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly encrypted: boolean;
  readonly activeContent: boolean;
}

export interface WorkspaceRestoreInput {
  /** Record type (`data/<name>.ndjson` without folder and extension) → extracted file. */
  readonly data: ReadonlyMap<string, string>;
  /** Verified originals by SHA-256. */
  readonly files: { readonly documents: ReadonlyMap<string, RestoredDocumentFileFacts>; readonly images: ReadonlyMap<string, { readonly bytes: number }> };
  /** The server admin restoring: the new Workspace's only member (ADMIN). */
  readonly admin: { readonly userId: string };
  readonly at: Date;
  /** false: check only (everything is rolled back). Otherwise `finish` runs in the same transaction before commit. */
  readonly commit: false | { readonly finish: (tx: Transaction, outcome: WorkspaceRestoreOutcome) => void };
}

export interface PreviousMember {
  readonly displayName: string;
  readonly email: string | null;
  readonly role: string;
}

export interface WorkspaceRestoreOutcome {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** Rows per record type, as restored. */
  readonly counts: Readonly<Record<string, number>>;
  /** Historical identities created. */
  readonly persons: number;
  /** For re-inviting by hand — nobody is invited automatically. */
  readonly previousMembers: readonly PreviousMember[];
  /** Codes of things restored differently than they were (e.g. `icon_unavailable`). */
  readonly warnings: readonly string[];
  readonly schedulesPaused: number;
  readonly assignmentsCleared: number;
  readonly storage: { readonly used: number; readonly limit: number; readonly images: number; readonly imageLimit: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const PERSON = /^person-[1-9][0-9]{0,8}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_DISPLAY_NAME = 200;

/** Columns holding an id without a foreign key (a snapshot's source, a polymorphic end): which table it names. */
const LOOSE_REFERENCES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  document_folders: { deleted_with_folder_id: 'document_folders' },
  documents: { deleted_with_folder_id: 'document_folders' },
  maintenance_records: { contact_id: 'contacts' },
  run_sections: { source_section_id: 'procedure_sections' },
  run_steps: { source_step_id: 'procedure_steps' },
  run_documents: { source_document_id: 'documents' },
  run_document_removals: { run_document_id: 'run_documents' },
  audit_events: { subject_id: null, client_change_id: null },
  links: { from_id: null, to_id: null },
};

/** Link end types and their tables (`links.from_type` / `to_type`). */
const LINK_TABLES: Readonly<Record<string, string>> = {
  document: 'documents',
  contact: 'contacts',
  procedure: 'procedures',
  schedule: 'schedules',
  maintenance: 'maintenance_records',
  run: 'runs',
  equipment: 'equipment_records',
};

type JsonShape = (value: unknown) => boolean;
const isString = (value: unknown): value is string => typeof value === 'string';
const stringArray: JsonShape = (value) => Array.isArray(value) && value.every(isString);
const contactPoints: JsonShape = (value) =>
  Array.isArray(value) && value.every((point) => typeof point === 'object' && point !== null && !Array.isArray(point) && Object.keys(point).every((key) => key === 'value' || key === 'label') && isString((point as Record<string, unknown>).value) && isString((point as Record<string, unknown>).label));
const REMINDER_UNITS = new Set(['DAYS', 'WEEKS', 'MONTHS', 'HOURS']);
const reminders: JsonShape = (value) =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'object' && item !== null && Object.keys(item).length === 2 && REMINDER_UNITS.has((item as Record<string, unknown>).unit as string) && Number.isSafeInteger((item as Record<string, unknown>).amount) && ((item as Record<string, unknown>).amount as number) >= 0);
const weekdays: JsonShape = (value) => Array.isArray(value) && value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);
const metadata: JsonShape = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((item) => ['string', 'number', 'boolean'].includes(typeof item) || stringArray(item));

/** JSON columns and the shape their content must have (the database checks only that some have arrays). */
const JSON_COLUMNS: Readonly<Record<string, Readonly<Record<string, JsonShape>>>> = {
  procedures: { tags: stringArray },
  runs: { tags: stringArray },
  documents: { tags: stringArray },
  equipment_records: { tags: stringArray },
  contacts: { emails: contactPoints, phones: contactPoints },
  schedules: { reminders, recurrence_weekdays: weekdays },
  audit_events: { metadata },
};

type ColumnRule =
  | { readonly kind: 'id' }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'person' }
  | { readonly kind: 'record'; readonly table: string }
  | { readonly kind: 'icon' }
  | { readonly kind: 'loose'; readonly table: string | null }
  | { readonly kind: 'copy' };

interface TablePlan {
  readonly spec: ExportedTable;
  /** Every column of the table, in database order. */
  readonly columns: readonly string[];
  /** The columns a package row must have — exactly. */
  readonly expected: ReadonlySet<string>;
  readonly rules: ReadonlyMap<string, ColumnRule>;
  readonly hasId: boolean;
  readonly insert: string;
}

/**
 * How each exported table is restored, from the database's own schema (`pragma_table_info`,
 * `pragma_foreign_key_list` with the table name bound). The INSERT statement is built from those column names —
 * checked against a strict identifier pattern, never from the package — and binds every value.
 */
function planTables(sqlite: AppDatabase['sqlite']): Map<string, TablePlan> {
  const columnsOf = sqlite.prepare('SELECT name, pk FROM pragma_table_info(?) ORDER BY cid');
  const keysOf = sqlite.prepare('SELECT "from" AS column, "table" AS target, "to" AS targetColumn FROM pragma_foreign_key_list(?)');
  const exported = new Set(EXPORTED_TABLES.map((spec) => spec.table));
  const plans = new Map<string, TablePlan>();
  for (const spec of EXPORTED_TABLES) {
    const info = columnsOf.all(spec.table) as { name: string; pk: number }[];
    const keys = keysOf.all(spec.table) as { column: string; target: string; targetColumn: string | null }[];
    const columns = info.map((column) => column.name);
    if (!IDENTIFIER.test(spec.table) || !columns.every((column) => IDENTIFIER.test(column))) throw new Error(`unexpected identifier in ${spec.table}`);
    const rules = new Map<string, ColumnRule>();
    const hasId = info.some((column) => column.name === 'id' && column.pk === 1);
    for (const column of columns) {
      const references = keys.filter((key) => key.column === column);
      const loose = LOOSE_REFERENCES[spec.table]?.[column];
      if (column === 'id' && hasId) rules.set(column, { kind: 'id' });
      else if (column === 'workspace_id') rules.set(column, { kind: 'workspace' });
      else if (spec.userColumns.includes(column)) rules.set(column, { kind: 'person' });
      else if (references.some((key) => key.target === 'users')) throw new Error(`${spec.table}.${column} refers to users but is no person column`);
      else if (references.some((key) => key.target === 'procedure_icons')) rules.set(column, { kind: 'icon' });
      else if (references.length > 0) {
        const direct = references.find((key) => exported.has(key.target) && (key.targetColumn ?? 'id') === 'id');
        if (direct === undefined) throw new Error(`${spec.table}.${column} refers to a table that is not restored`);
        rules.set(column, { kind: 'record', table: direct.target });
      } else if (loose !== undefined) rules.set(column, { kind: 'loose', table: loose });
      // An id column nobody classified would carry a source id into this server unchanged: never.
      else if (column.endsWith('_id')) throw new Error(`${spec.table}.${column} holds an id but is not classified for restore`);
      else rules.set(column, { kind: 'copy' });
    }
    // The package leaves out the Workspace id column (implied) and the columns the export omits.
    const expected = new Set(columns.filter((column) => column !== 'workspace_id' && !spec.omit.includes(column)));
    const inserted = spec.table === 'workspaces' ? columns.filter((column) => column === 'id' || expected.has(column)) : columns.filter((column) => !spec.omit.includes(column) || column === 'preview_state' || column === 'preview_attempts');
    const statement = 'INSERT INTO "' + spec.table + '" (' + inserted.map((column) => '"' + column + '"').join(', ') + ') VALUES (' + inserted.map(() => '?').join(', ') + ')';
    plans.set(spec.table, { spec, columns: inserted, expected, rules, hasId, insert: statement });
  }
  return plans;
}

/** The package's records of one type, one JSON object per line, with a bounded line length; strict UTF-8. */
function* records(path: string | undefined, table: string): Generator<Record<string, unknown>> {
  if (path === undefined) throw new WorkspaceRestoreError('malformed_records', table);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parse = (bytes: Buffer): Record<string, unknown> => {
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new WorkspaceRestoreError('malformed_records', table);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WorkspaceRestoreError('malformed_records', table);
    return value as Record<string, unknown>;
  };
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    let carry = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const chunk = carry.length === 0 ? buffer.subarray(0, read) : Buffer.concat([carry, buffer.subarray(0, read)]);
      let start = 0;
      for (let end = chunk.indexOf(10, start); end !== -1; end = chunk.indexOf(10, start)) {
        yield parse(chunk.subarray(start, end));
        start = end + 1;
      }
      carry = Buffer.from(chunk.subarray(start));
      if (carry.length > MAX_LINE_BYTES) throw new WorkspaceRestoreError('malformed_records', table);
    }
    if (carry.length > 0) yield parse(carry);
  } finally {
    closeSync(fd);
  }
}

/** A package row: exactly the expected columns, every value a string, a finite number or null. */
function checkRow(plan: TablePlan, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  if (keys.length !== plan.expected.size || !keys.every((key) => plan.expected.has(key))) throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
  for (const key of keys) {
    const value = row[key];
    if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
  }
  const shapes = JSON_COLUMNS[plan.spec.table];
  if (shapes !== undefined) {
    for (const [column, shape] of Object.entries(shapes)) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
      }
      if (!shape(parsed)) throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
    }
  }
}

/** A database refusal while inserting, as the restore's answer: a broken relationship or a malformed record. */
function refusal(error: unknown, table: string): unknown {
  if (error instanceof WorkspaceRestoreError) return error;
  // Only a constraint (CHECK, FOREIGN KEY, UNIQUE, NOT NULL, a trigger's RAISE) says something about the package;
  // anything else (disk full, I/O) is a failure of this server and is reported as such.
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('SQLITE_CONSTRAINT')) return error;
  return new WorkspaceRestoreError(code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ? 'broken_reference' : 'malformed_records', table);
}

class CheckOnly extends Error {
  readonly outcome: WorkspaceRestoreOutcome;
  constructor(outcome: WorkspaceRestoreOutcome) {
    super('check only');
    this.outcome = outcome;
  }
}

/**
 * Restores the extracted package into a new Workspace — or, with `commit: false`, checks that it would, and
 * rolls everything back. Synchronous: one IMMEDIATE transaction holds the write lock from start to end.
 */
export function restoreWorkspace(database: AppDatabase, input: WorkspaceRestoreInput): WorkspaceRestoreOutcome {
  const { sqlite, db } = database;
  const plans = planTables(sqlite);
  const at = input.at.getTime();
  try {
    return db.transaction((tx): WorkspaceRestoreOutcome => {
      const admin = sqlite.prepare('SELECT status, server_admin AS serverAdmin FROM users WHERE id = ?').get(input.admin.userId) as { status: string; serverAdmin: number } | undefined;
      if (admin?.status !== 'ACTIVE' || admin.serverAdmin !== 1) throw new WorkspaceRestoreError('forbidden');

      // 1. People of the package → historical identities (only those any record names).
      const persons = new Map<string, { displayName: string; email: string | null }>();
      for (const row of records(input.data.get('persons'), 'persons')) {
        const keys = Object.keys(row).sort().join(',');
        const { ref, displayName, email } = row;
        if (keys !== 'displayName,email,ref' || typeof ref !== 'string' || !PERSON.test(ref) || persons.has(ref)) throw new WorkspaceRestoreError('malformed_records', 'persons');
        if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.length > MAX_DISPLAY_NAME) throw new WorkspaceRestoreError('malformed_records', 'persons');
        if (email !== null && (typeof email !== 'string' || email.length > 254)) throw new WorkspaceRestoreError('malformed_records', 'persons');
        persons.set(ref, { displayName, email });
      }

      // 2. Every record id of the package, unique across all types → a new id.
      const ids = new Map<string, string>();
      const tableOf = new Map<string, string>();
      for (const plan of plans.values()) {
        if (!plan.hasId || plan.spec.table === 'workspaces') continue;
        for (const row of records(input.data.get(plan.spec.name), plan.spec.name)) {
          const id = row.id;
          if (typeof id !== 'string' || !UUID.test(id) || ids.has(id)) throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
          ids.set(id, randomUUID());
          tableOf.set(id, plan.spec.table);
        }
      }
      // Ids the package mentions but does not contain: a fresh id each, the same for every mention.
      const unknown = new Map<string, string>();
      const fresh = (id: string) => {
        let mapped = unknown.get(id);
        if (mapped === undefined) {
          mapped = randomUUID();
          unknown.set(id, mapped);
        }
        return mapped;
      };

      const workspaceId = randomUUID();
      const usedPersons = new Map<string, string>();
      const createPerson = sqlite.prepare("INSERT INTO users (id, display_name, email, email_verified, image, status, server_admin, created_at, updated_at) VALUES (?, ?, ?, 0, NULL, 'IMPORTED', 0, ?, ?)");
      const personId = (ref: unknown, table: string): string | null => {
        if (ref === null) return null;
        if (typeof ref !== 'string' || !persons.has(ref)) throw new WorkspaceRestoreError('broken_reference', table);
        let id = usedPersons.get(ref);
        if (id === undefined) {
          id = randomUUID();
          createPerson.run(id, (persons.get(ref) as { displayName: string }).displayName, `${id}@${IMPORTED_EMAIL_DOMAIN}`, at, at);
          usedPersons.set(ref, id);
        }
        return id;
      };
      const icons = new Set((sqlite.prepare('SELECT key FROM procedure_icons').all() as { key: string }[]).map((row) => row.key));
      const warnings = new Set<string>();
      const counts: Record<string, number> = {};
      let schedulesPaused = 0;
      let assignmentsCleared = 0;

      const mapValue = (plan: TablePlan, column: string, value: unknown): unknown => {
        const rule = plan.rules.get(column) as ColumnRule;
        const table = plan.spec.name;
        switch (rule.kind) {
          case 'id':
            return ids.get(value as string);
          case 'workspace':
            return workspaceId;
          case 'person':
            return personId(value, table);
          case 'icon':
            if (value === null || (typeof value === 'string' && icons.has(value))) return value;
            warnings.add('icon_unavailable');
            return null;
          case 'record': {
            if (value === null) return null;
            if (typeof value !== 'string' || tableOf.get(value) !== rule.table) throw new WorkspaceRestoreError('broken_reference', table);
            return ids.get(value);
          }
          case 'loose': {
            if (value === null) return null;
            if (typeof value !== 'string') throw new WorkspaceRestoreError('malformed_records', table);
            if (value === WORKSPACE_REFERENCE) return workspaceId;
            if (!UUID.test(value)) return value;
            const known = tableOf.get(value);
            if (known !== undefined) {
              if (rule.table !== null && known !== rule.table) throw new WorkspaceRestoreError('broken_reference', table);
              return ids.get(value);
            }
            return fresh(value);
          }
          case 'copy':
            return value;
        }
      };

      // 3. The Workspace itself, marked as being restored, with the restoring admin as its only member.
      const workspacePlan = plans.get('workspaces') as TablePlan;
      let workspaceRow: Record<string, unknown> | undefined;
      for (const row of records(input.data.get('workspace'), 'workspace')) {
        if (workspaceRow !== undefined) throw new WorkspaceRestoreError('malformed_records', 'workspace');
        checkRow(workspacePlan, row);
        workspaceRow = row;
      }
      if (workspaceRow === undefined) throw new WorkspaceRestoreError('malformed_records', 'workspace');
      const name = workspaceRow.name;
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_WORKSPACE_NAME_LENGTH) throw new WorkspaceRestoreError('malformed_records', 'workspace');
      try {
        sqlite.prepare(workspacePlan.insert).run(...workspacePlan.columns.map((column) => (column === 'id' ? workspaceId : mapValue(workspacePlan, column, workspaceRow[column]))));
        sqlite.prepare('INSERT INTO workspace_restore_marks (workspace_id) VALUES (?)').run(workspaceId);
        sqlite.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'ADMIN', ?, ?)").run(workspaceId, input.admin.userId, at, at);
      } catch (error) {
        throw refusal(error, 'workspace');
      }

      // 4. Every other record, in reference order.
      const previousMembers: PreviousMember[] = [];
      const documentShas = new Set<string>();
      const imageShas = new Set<string>();
      const restoredContacts: string[] = [];
      for (const plan of plans.values()) {
        const table = plan.spec.table;
        if (table === 'workspaces') continue;
        const statement = table === 'memberships' ? undefined : sqlite.prepare(plan.insert);
        let rows = 0;
        for (const row of records(input.data.get(plan.spec.name), plan.spec.name)) {
          checkRow(plan, row);
          if (table === 'memberships') {
            // Not restored (D1): shown so the admin can invite people again — by hand.
            const role = row.role;
            if (typeof role !== 'string' || !(WORKSPACE_ROLES as readonly string[]).includes(role)) throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
            const person = typeof row.user_id === 'string' ? persons.get(row.user_id) : undefined;
            if (person === undefined) throw new WorkspaceRestoreError('broken_reference', plan.spec.name);
            previousMembers.push({ displayName: person.displayName, email: person.email, role });
            rows++;
            continue;
          }
          const values = new Map<string, unknown>();
          for (const column of plan.columns) values.set(column, plan.expected.has(column) || column === 'workspace_id' ? mapValue(plan, column, row[column]) : undefined);

          if (table === 'document_files') {
            const sha = row.sha256;
            const facts = typeof sha === 'string' ? input.files.documents.get(sha) : undefined;
            if (facts === undefined) throw new WorkspaceRestoreError('missing_file', plan.spec.name);
            if (facts.bytes !== row.bytes || facts.format !== row.format) throw new WorkspaceRestoreError('file_mismatch', plan.spec.name);
            documentShas.add(sha as string);
            // What the bytes are, as this server inspected them; previews are made again.
            values.set('page_count', facts.pageCount);
            values.set('width', facts.width);
            values.set('height', facts.height);
            values.set('encrypted', facts.encrypted ? 1 : 0);
            values.set('active_content', facts.activeContent ? 1 : 0);
            values.set('preview_state', 'PENDING');
            values.set('preview_attempts', 0);
          } else if (table === 'step_images') {
            const sha = row.sha256;
            const facts = typeof sha === 'string' ? input.files.images.get(sha) : undefined;
            if (facts === undefined) throw new WorkspaceRestoreError('missing_file', plan.spec.name);
            if (facts.bytes !== row.bytes) throw new WorkspaceRestoreError('file_mismatch', plan.spec.name);
            imageShas.add(sha as string);
          } else if (table === 'document_file_texts') {
            // A recognition that was running on the source is queued again here.
            if (values.get('state') === 'PROCESSING') values.set('state', 'QUEUED');
            values.set('lease_until', null);
          } else if (table === 'documents') {
            // Derived search columns are calculated here, never taken from the package (D8).
            const tags = JSON.parse(row.tags as string) as string[];
            const notes = typeof row.notes === 'string' ? row.notes : '';
            const title = typeof row.title === 'string' ? row.title : '';
            values.set('title_key', documentTitleKey(title));
            values.set('tag_keys', JSON.stringify(documentTagKeys(tags)));
            values.set('search_text', documentSearchText({ title, notes, tags }));
          } else if (table === 'schedules') {
            // D7: nothing restored reminds anyone — active Schedules are paused, assignments cleared.
            if (values.get('assignee_user_id') !== null) assignmentsCleared++;
            values.set('assignee_user_id', null);
            if (values.get('state') === 'ACTIVE') {
              values.set('state', 'PAUSED');
              values.set('paused_at', at);
              schedulesPaused++;
            }
          } else if (table === 'occurrences') {
            if (values.get('assignee_user_id') !== null) assignmentsCleared++;
            values.set('assignee_user_id', null);
          } else if (table === 'maintenance_records') {
            // The trigger requiring a live contact is relaxed for this restore: a contact must be one of the package.
            const contact = row.contact_id;
            if (contact !== null && (typeof contact !== 'string' || tableOf.get(contact) !== 'contacts')) throw new WorkspaceRestoreError('broken_reference', plan.spec.name);
          } else if (table === 'links') {
            // Each end must be a record of the package of the named type — unless it was deleted for good (marked gone).
            for (const end of ['from', 'to'] as const) {
              const type = row[`${end}_type`];
              const id = row[`${end}_id`];
              const target = typeof type === 'string' ? LINK_TABLES[type] : undefined;
              if (target === undefined || typeof id !== 'string') throw new WorkspaceRestoreError('malformed_records', plan.spec.name);
              const known = tableOf.get(id);
              if (row[`${end}_gone_at`] === null ? known !== target : known !== undefined && known !== target) throw new WorkspaceRestoreError('broken_reference', plan.spec.name);
            }
          } else if (table === 'audit_events' && typeof row.metadata === 'string') {
            // Ids inside the metadata are rebuilt like any reference; the Workspace's own id is the new one.
            values.set('metadata', row.metadata.replace(UUID_IN_TEXT, (id) => ids.get(id) ?? fresh(id)).replaceAll(WORKSPACE_REFERENCE, workspaceId));
          }
          if (table === 'contacts') restoredContacts.push(values.get('id') as string);
          try {
            (statement as ReturnType<typeof sqlite.prepare>).run(plan.columns.map((column) => values.get(column)));
          } catch (error) {
            throw refusal(error, plan.spec.name);
          }
          rows++;
        }
        counts[plan.spec.name] = rows;
      }

      // 5. Every original of the package is used, and nothing else is stored.
      if (documentShas.size !== input.files.documents.size || imageShas.size !== input.files.images.size) throw new WorkspaceRestoreError('unexpected_file');

      // 6. Derived contact keys (D8), the mark removed, the server's storage ceilings checked.
      const contactRow = sqlite.prepare('SELECT name, emails, phones FROM contacts WHERE id = ?');
      const insertKey = sqlite.prepare('INSERT INTO contact_keys (contact_id, workspace_id, kind, key) VALUES (?, ?, ?, ?)');
      for (const contactId of restoredContacts) {
        const contact = contactRow.get(contactId) as { name: string; emails: string; phones: string };
        for (const key of contactKeys({ name: contact.name, emails: JSON.parse(contact.emails) as ContactPoint[], phones: JSON.parse(contact.phones) as ContactPoint[] })) insertKey.run(contactId, workspaceId, key.kind, key.key);
      }
      sqlite.prepare('DELETE FROM workspace_restore_marks WHERE workspace_id = ?').run(workspaceId);
      const usage = storageUsageIn(tx, workspaceId, input.at);
      const imageLimit = (sqlite.prepare('SELECT image_quota_bytes AS n FROM workspaces WHERE id = ?').get(workspaceId) as { n: number }).n;
      if (usage.used > usage.limit || usage.images > imageLimit) throw new WorkspaceRestoreError('storage_limit');

      const outcome: WorkspaceRestoreOutcome = {
        workspaceId,
        workspaceName: name,
        counts,
        persons: usedPersons.size,
        previousMembers,
        warnings: [...warnings].sort(),
        schedulesPaused,
        assignmentsCleared,
        storage: { used: usage.used, limit: usage.limit, images: usage.images, imageLimit },
      };
      if (input.commit === false) throw new CheckOnly(outcome);
      input.commit.finish(tx, outcome);
      return outcome;
    }, IMMEDIATE);
  } catch (error) {
    if (error instanceof CheckOnly) return error.outcome;
    throw error;
  }
}
