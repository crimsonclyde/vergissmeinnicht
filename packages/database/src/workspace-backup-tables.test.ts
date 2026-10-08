import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from './test-support.ts';
import { EXCLUDED_TABLES, EXPORTED_TABLES } from './workspace-backup-tables.ts';

/**
 * The columns of every exported table as reviewed for section 18 (2026-10-08). A new column makes this test
 * fail until someone decides whether it belongs in a Workspace backup (and adds it to `omit` if not).
 */
const REVIEWED_COLUMNS: Record<string, string> = {
  workspaces: 'id name created_by_user_id created_at updated_at image_quota_bytes storage_quota_bytes storage_limit_bytes tools_revision text_recognition',
  workspace_tools: 'workspace_id tool enabled updated_at updated_by_user_id',
  memberships: 'workspace_id user_id role created_at updated_at',
  step_images: 'id workspace_id sha256 bytes width height created_by_user_id created_at',
  procedures: 'id workspace_id title description icon tags revision created_by_user_id created_at updated_at deleted_at deleted_by_user_id',
  procedure_sections: 'id procedure_id position title description',
  procedure_steps: 'id procedure_id section_id position kind title description icon required critical skip_reason_policy not_applicable_reason_policy image_id image_caption',
  contacts: 'id workspace_id name organisation category emails phones address website notes sort_key category_key search_text revision created_by_user_id created_by_display_name created_at updated_by_user_id updated_by_display_name updated_at deleted_at deleted_by_user_id deleted_by_display_name',
  document_types: 'id workspace_id name name_key retired_at created_by_user_id created_at',
  document_folders: 'id workspace_id parent_id name name_key revision created_by_user_id created_by_display_name created_at updated_at deleted_at deleted_by_user_id deleted_by_display_name deleted_with_folder_id',
  document_files: 'id workspace_id sha256 bytes format original_name page_count width height encrypted active_content preview_state preview_attempts uploaded_by_user_id uploaded_by_display_name created_at',
  documents: 'id workspace_id folder_id title type_key type_id document_date year notes tags revision created_by_user_id created_by_display_name created_at updated_by_user_id updated_by_display_name updated_at deleted_at deleted_by_user_id deleted_by_display_name deleted_with_folder_id title_key tag_keys search_text',
  document_pages: 'document_id workspace_id position file_id',
  document_file_texts: 'file_id workspace_id state priority attempts lease_until error_code source text search_text bytes pages truncated corrected_text corrected_search_text correction_bytes corrected_by_user_id corrected_by_display_name corrected_at text_revision queued_at updated_at',
  document_suggestion_dismissals: 'document_id workspace_id key dismissed_by_user_id dismissed_at',
  equipment_records: 'id workspace_id name category location manufacturer model serial_number purchase_date warranty_expiry notes category_key location_key manufacturer_key sort_key search_text revision created_by_user_id created_by_display_name created_at updated_by_user_id updated_by_display_name updated_at deleted_at deleted_by_user_id deleted_by_display_name',
  maintenance_records: 'id workspace_id title category date status completed_on description contact_id cost_amount cost_currency category_key sort_date search_text revision created_by_user_id created_by_display_name created_at updated_by_user_id updated_by_display_name updated_at deleted_at deleted_by_user_id deleted_by_display_name',
  runs: 'id workspace_id procedure_id procedure_revision title description icon tags state revision started_by_user_id started_by_display_name started_at ended_by_user_id ended_by_display_name ended_at end_reason',
  run_sections: 'id run_id position source_section_id title description',
  run_steps: 'id run_id run_section_id position source_step_id kind title description icon required critical skip_reason_policy not_applicable_reason_policy state state_reason state_changed_by_user_id state_changed_by_display_name state_changed_at state_changed_device_at image_id image_caption',
  audit_events: 'id workspace_id occurred_at type actor_user_id actor_display_name subject_type subject_id metadata run_id client_change_id',
  run_documents: 'id workspace_id run_id source_document_id source_revision title type_key type_name document_date year notes tags linked_by_user_id linked_by_display_name linked_at',
  run_document_files: 'run_document_id workspace_id position file_id',
  run_document_removals: 'id workspace_id run_id run_document_id reason files linked_by_display_name linked_at removed_by_user_id removed_by_display_name removed_at',
  schedules: 'id workspace_id kind procedure_id title description recurrence_kind recurrence_unit recurrence_interval recurrence_weekdays recurrence_last_day anchor_date time time_zone reminders assignee_user_id state paused_at ended_at ended_by_user_id ended_by_display_name revision created_by_user_id created_by_display_name created_at updated_at',
  occurrences: 'id schedule_id workspace_id due_date time state assignee_user_id closed_at closed_by_user_id closed_by_display_name skip_reason revision created_at updated_at',
  occurrence_runs: 'id occurrence_id run_id workspace_id how linked_at linked_by_user_id linked_by_display_name ended_at end_reason',
  lists: 'id workspace_id kind title revision created_by_user_id created_by_display_name created_at updated_at deleted_at deleted_by_user_id deleted_by_display_name title_changed_at title_changed_by_display_name',
  list_items: 'id list_id workspace_id position title quantity unit revision created_by_user_id created_by_display_name created_at checked_at checked_by_user_id checked_by_display_name deleted_at deleted_by_display_name content_changed_at content_changed_by_display_name check_changed_at check_changed_by_display_name',
  links: 'id workspace_id from_type from_id to_type to_id created_by_user_id created_by_display_name created_at from_gone_at from_gone_by_display_name to_gone_at to_gone_by_display_name',
};

describe('Workspace backup allowlist (section 18)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    database = createTestDatabase();
  });
  afterEach(() => database.dispose());

  const tables = () =>
    (database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);

  it('classifies every table: exported with its rows and columns, or excluded with a reason', () => {
    const exported = new Set(EXPORTED_TABLES.map((spec) => spec.table));
    const unclassified = tables().filter((name) => !exported.has(name) && EXCLUDED_TABLES[name] === undefined);
    expect(unclassified).toEqual([]);
    expect([...exported].filter((name) => EXCLUDED_TABLES[name] !== undefined)).toEqual([]);
    expect(Object.keys(EXCLUDED_TABLES).filter((name) => !tables().includes(name))).toEqual([]);
    for (const reason of Object.values(EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(5);
  });

  it('never exports a table holding secrets, tokens, sessions or personal settings', () => {
    const exported = new Set(EXPORTED_TABLES.map((spec) => spec.table));
    for (const secret of ['users', 'sessions', 'accounts', 'verifications', 'totp_credentials', 'recovery_codes', 'mfa_challenges', 'account_recoveries', 'invitations', 'knots', 'security_events', 'notification_providers', 'telegram_links', 'telegram_pairings', 'weather_credentials', 'user_weather_settings', 'user_today_layouts', 'notification_preferences', 'procedure_pins']) {
      expect({ secret, exported: exported.has(secret) }).toEqual({ secret, exported: false });
    }
  });

  it('knows every column of every exported table, and every user column is turned into a person reference', () => {
    for (const spec of EXPORTED_TABLES) {
      const columns = (database.sqlite.prepare(`PRAGMA table_info(${spec.table})`).all() as { name: string }[]).map((row) => row.name);
      expect({ table: spec.table, columns: columns.join(' ') }).toEqual({ table: spec.table, columns: REVIEWED_COLUMNS[spec.table] });
      for (const column of [...spec.userColumns, ...spec.omit]) expect({ table: spec.table, column, known: columns.includes(column) }).toEqual({ table: spec.table, column, known: true });
      // Any column that refers to a user must be listed as a user column (never exported as an id).
      for (const column of columns.filter((name) => /(^|_)user_id$/.test(name))) expect({ table: spec.table, column, mapped: spec.userColumns.includes(column) }).toEqual({ table: spec.table, column, mapped: true });
    }
  });

  it('selects rows only through the Workspace id', () => {
    for (const spec of EXPORTED_TABLES) {
      expect(spec.from).toMatch(/\?/);
      expect(spec.from).not.toMatch(/\$\{|'/);
    }
  });
});
