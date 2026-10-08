/**
 * The explicit allowlist of a Workspace backup (section 18). Every table of the schema is either exported —
 * with the rows that belong to the Workspace, its user columns turned into package-local person references
 * and the columns listed under `omit` left out — or excluded with a reason. A test fails when a table or a
 * column of an exported table is not classified here, so nothing new can slip into (or out of) a backup.
 *
 * The `from` clauses are constants: the only value bound into them is the Workspace id.
 */
export interface ExportedTable {
  /** Database table. */
  readonly table: string;
  /** `data/<name>.ndjson` in the package. */
  readonly name: string;
  /** `FROM … WHERE …` selecting this Workspace's rows; `?` is the Workspace id (every `?`). */
  readonly from: string;
  /** The complete statement, built once here from constants (table names in code, never input). */
  readonly select: string;
  /** Columns holding a user id: written as a person reference (`persons.ndjson`), never the id. */
  readonly userColumns: readonly string[];
  /** Columns never written, with the reason in a comment where they are listed. */
  readonly omit: readonly string[];
  /** The file a row refers to by its SHA-256 (`files/<store>/<sha256>`). */
  readonly fileStore?: 'documents' | 'images';
}

const own = (table: string) => `${table} t WHERE t.workspace_id = ?`;
const of = (table: string, column: string, parent: string) => `${table} t WHERE t.${column} IN (SELECT id FROM ${parent} WHERE workspace_id = ?)`;

type Spec = Omit<ExportedTable, 'select'>;

/** Exported, in an order where every row's references come earlier (the restore inserts in this order). */
const SPECS: readonly Spec[] = [
  // The Workspace itself: name, its own storage limit, text recognition. Its id, the server's ceiling and counters are server-specific.
  { table: 'workspaces', name: 'workspace', from: 'workspaces t WHERE t.id = ?', userColumns: ['created_by_user_id'], omit: ['id', 'image_quota_bytes', 'storage_quota_bytes', 'tools_revision'] },
  { table: 'workspace_tools', name: 'workspace_tools', from: own('workspace_tools'), userColumns: ['updated_by_user_id'], omit: [] },
  // Members: role per person; name and email are in persons.ndjson (B3).
  { table: 'memberships', name: 'memberships', from: own('memberships'), userColumns: ['user_id'], omit: [] },
  { table: 'step_images', name: 'step_images', from: own('step_images'), userColumns: ['created_by_user_id'], omit: [], fileStore: 'images' },
  { table: 'procedures', name: 'procedures', from: own('procedures'), userColumns: ['created_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'procedure_sections', name: 'procedure_sections', from: of('procedure_sections', 'procedure_id', 'procedures'), userColumns: [], omit: [] },
  { table: 'procedure_steps', name: 'procedure_steps', from: of('procedure_steps', 'procedure_id', 'procedures'), userColumns: [], omit: [] },
  { table: 'contacts', name: 'contacts', from: own('contacts'), userColumns: ['created_by_user_id', 'updated_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'document_types', name: 'document_types', from: own('document_types'), userColumns: ['created_by_user_id'], omit: [] },
  { table: 'document_folders', name: 'document_folders', from: own('document_folders'), userColumns: ['created_by_user_id', 'deleted_by_user_id'], omit: [] },
  // Originals by hash; previews are regenerated after a restore, so their processing state is not kept.
  { table: 'document_files', name: 'document_files', from: own('document_files'), userColumns: ['uploaded_by_user_id'], omit: ['preview_state', 'preview_attempts'], fileStore: 'documents' },
  { table: 'documents', name: 'documents', from: own('documents'), userColumns: ['created_by_user_id', 'updated_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'document_pages', name: 'document_pages', from: own('document_pages'), userColumns: [], omit: [] },
  // Recognised text and corrections (expensive to regenerate); a worker's lease is runtime state.
  { table: 'document_file_texts', name: 'document_file_texts', from: own('document_file_texts'), userColumns: ['corrected_by_user_id'], omit: ['lease_until'] },
  { table: 'document_suggestion_dismissals', name: 'document_suggestion_dismissals', from: own('document_suggestion_dismissals'), userColumns: ['dismissed_by_user_id'], omit: [] },
  { table: 'equipment_records', name: 'equipment_records', from: own('equipment_records'), userColumns: ['created_by_user_id', 'updated_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'maintenance_records', name: 'maintenance_records', from: own('maintenance_records'), userColumns: ['created_by_user_id', 'updated_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'runs', name: 'runs', from: own('runs'), userColumns: ['started_by_user_id', 'ended_by_user_id'], omit: [] },
  { table: 'run_sections', name: 'run_sections', from: of('run_sections', 'run_id', 'runs'), userColumns: [], omit: [] },
  { table: 'run_steps', name: 'run_steps', from: of('run_steps', 'run_id', 'runs'), userColumns: ['state_changed_by_user_id'], omit: [] },
  { table: 'audit_events', name: 'audit_events', from: own('audit_events'), userColumns: ['actor_user_id'], omit: [] },
  { table: 'run_documents', name: 'run_documents', from: own('run_documents'), userColumns: ['linked_by_user_id'], omit: [] },
  { table: 'run_document_files', name: 'run_document_files', from: own('run_document_files'), userColumns: [], omit: [] },
  { table: 'run_document_removals', name: 'run_document_removals', from: own('run_document_removals'), userColumns: ['removed_by_user_id'], omit: [] },
  { table: 'schedules', name: 'schedules', from: own('schedules'), userColumns: ['assignee_user_id', 'ended_by_user_id', 'created_by_user_id'], omit: [] },
  { table: 'occurrences', name: 'occurrences', from: own('occurrences'), userColumns: ['assignee_user_id', 'closed_by_user_id'], omit: [] },
  { table: 'occurrence_runs', name: 'occurrence_runs', from: own('occurrence_runs'), userColumns: ['linked_by_user_id'], omit: [] },
  { table: 'lists', name: 'lists', from: own('lists'), userColumns: ['created_by_user_id', 'deleted_by_user_id'], omit: [] },
  { table: 'list_items', name: 'list_items', from: own('list_items'), userColumns: ['created_by_user_id', 'checked_by_user_id'], omit: [] },
  { table: 'links', name: 'links', from: own('links'), userColumns: ['created_by_user_id'], omit: [] },
];

// Rows in insertion order (rowid): the package is deterministic, and a restore — inserting in package order —
// keeps that order, so a restored Workspace exports its records in the same order as the original (18c).
export const EXPORTED_TABLES: readonly ExportedTable[] = SPECS.map((spec) => ({ ...spec, select: 'SELECT t.* FROM ' + spec.from + ' ORDER BY t.rowid' }));

/** Never in a Workspace backup, with the reason (section 18, B3, 18.1 "never included"). */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  users: 'accounts are not Workspace data; people appear as person references (name, and email for members)',
  sessions: 'sign-in sessions',
  accounts: 'password hashes and provider tokens',
  verifications: 'verification values',
  totp_credentials: 'TOTP seeds (sealed)',
  recovery_codes: 'recovery code hashes',
  mfa_challenges: 'sign-in challenges',
  account_recoveries: 'recovery tokens',
  invitations: 'invitation tokens',
  knots: 'Knot tokens — Knots are not restored',
  security_events: 'server security log',
  rate_limits: 'server rate-limit counters',
  user_preferences: 'personal presentation settings',
  user_today_layouts: 'personal Today layouts',
  user_weather_settings: 'personal weather settings and locations',
  weather_credentials: 'weather provider credentials (sealed), any scope',
  server_weather_settings: 'server settings',
  instance_settings: 'server settings',
  notification_preferences: 'personal notification settings',
  notification_providers: 'server notification credentials (sealed)',
  notification_summaries: 'delivery records',
  reminder_deliveries: 'delivery records',
  scheduled_reminders: 'planned deliveries — restored Schedules start paused and send nothing (D7)',
  telegram_links: 'personal Telegram chats',
  telegram_pairings: 'Telegram pairing tokens',
  procedure_pins: 'personal pins',
  procedure_icons: 'the server’s icon catalogue',
  list_client_changes: 'offline-sync bookkeeping of devices',
  contact_keys: 'derived — recalculated on restore (D8)',
  document_file_derivatives: 'previews — regenerated after a restore',
  workspace_backup_jobs: 'backup jobs themselves',
  workspace_restore_marks: 'exists only inside a restore’s own transaction',
  historical_identity_origins: 'server-local origin of historical identities (people appear as person references)',
};
