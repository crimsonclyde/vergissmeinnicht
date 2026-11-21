/**
 * One manifest per Workspace tool (45.7–45.9, steps 28.2–28.4). What the core needs to know about a tool
 * lives here instead of in a dozen central lists: its navigation family, the capability groups it
 * gates, the Workspace API paths it owns and the backup tables it exports. The web app (navigation,
 * Plugins tab) and the server (tool gate of capabilities, the tool-off sweep, backup coverage) read
 * it. Tools stay bundled, reviewed code: nothing is ever loaded at runtime, and schema changes stay in
 * reviewed migrations (a new tool id is one INSERT into `tool_ids`, 45.3).
 */
import { WORKSPACE_TOOLS, type WorkspaceTool } from './document.ts';

/** A family of the desktop menu bar, the classic sidebar and the phone drawer (section 42). */
export type ToolFamily = 'plan' | 'shop' | 'house';

/**
 * A Workspace API path the tool owns, matched against the path after `/workspaces/:workspaceId`.
 * A plain pattern answers 404 while this tool is off; `anyOf` answers 404 only while all those tools are
 * off (Schedules serve Procedures and Reminders).
 */
export type ToolRoute = RegExp | { readonly pattern: RegExp; readonly anyOf: readonly WorkspaceTool[] };

/** What an AI assistant can do with a tool's records through MCP (48.2). */
export type McpAction = 'read' | 'create' | 'update' | 'delete';
/**
 * A tool's MCP coverage: the actions AI assistants have tools for, or why the tool is not for AI. The
 * coverage test (`apps/server/src/mcp/mcp-coverage.test.ts`) fails when a listed action has no MCP tool,
 * or a tool has MCP tools although it says it is not for AI — so a new feature cannot quietly stay out
 * of reach of the assistant.
 */
export type ToolMcpCoverage = { readonly covers: readonly McpAction[]; readonly note?: string } | { readonly notForAi: string };

export interface ToolManifest {
  readonly tool: WorkspaceTool;
  /** Where the tool appears in the navigation; `null` for tools without a page of their own in it. */
  readonly family: ToolFamily | null;
  /** Capability groups (`equipment` of `equipment.view`) that need this tool switched on. */
  readonly capabilityGroups: readonly string[];
  readonly routes: readonly ToolRoute[];
  /** Workspace backup tables that hold this tool's records. */
  readonly backupTables: readonly string[];
  readonly mcp: ToolMcpCoverage;
}

const ALL: readonly McpAction[] = ['read', 'create', 'update', 'delete'];

const SCHEDULES: ToolRoute = { pattern: /^\/(schedules|occurrences)(\/|$)/, anyOf: ['PROCEDURES', 'REMINDERS'] };

export const TOOL_MANIFESTS: readonly ToolManifest[] = Object.freeze([
  {
    tool: 'PROCEDURES', family: 'plan', capabilityGroups: ['procedure', 'run', 'knot'],
    routes: [/^\/(procedures|runs|knots|images)(\/|$)/, SCHEDULES],
    backupTables: ['step_images', 'procedures', 'procedure_sections', 'procedure_steps', 'runs', 'run_sections', 'run_steps'],
    mcp: { covers: ALL, note: 'Deleting hides a Procedure; Runs are aborted, never deleted.' },
  },
  { tool: 'REMINDERS', family: 'plan', capabilityGroups: [], routes: [SCHEDULES], backupTables: [], mcp: { covers: ['read', 'create', 'update'], note: 'A Reminder is ended (set_reminder_state), never deleted: its history stays.' } },
  { tool: 'LISTS', family: 'shop', capabilityGroups: ['list'], routes: [/^\/lists(\/|$)/, /^\/recipes\/:recipeId\/shopping$/], backupTables: ['lists', 'list_items'], mcp: { covers: ALL } },
  { tool: 'CALENDAR', family: 'plan', capabilityGroups: [], routes: [/^\/(calendar|calendar-feed)(\/|$)/], backupTables: [], mcp: { covers: ['read'], note: 'A view: its entries are changed through the Reminder and Procedure tools.' } },
  {
    tool: 'DOCUMENTS', family: 'house', capabilityGroups: ['document'],
    routes: [/^\/(documents|document-files|document-folders|document-types|document-links|text-recognition)(\/|$)/, /^\/runs\/:runId\/documents/],
    backupTables: ['document_types', 'document_folders', 'document_files', 'documents', 'document_pages', 'document_file_texts', 'document_suggestion_dismissals'],
    mcp: { covers: ['read', 'update', 'delete'], note: 'A Document needs uploaded files; files never pass through MCP.' },
  },
  { tool: 'CONTACTS', family: 'house', capabilityGroups: ['contact'], routes: [/^\/(contacts|contact-links)(\/|$)/], backupTables: ['contacts'], mcp: { covers: ALL } },
  { tool: 'MAINTENANCE', family: 'house', capabilityGroups: ['maintenance'], routes: [/^\/(maintenance|maintenance-links)(\/|$)/], backupTables: ['maintenance_records'], mcp: { covers: ALL } },
  { tool: 'EQUIPMENT', family: 'house', capabilityGroups: ['equipment'], routes: [/^\/(equipment|equipment-links)(\/|$)/], backupTables: ['equipment_records'], mcp: { covers: ALL } },
  { tool: 'MOON', family: null, capabilityGroups: [], routes: [/^\/moon$/], backupTables: [], mcp: { notForAi: 'Shows the moon phase; it holds no records.' } },
  { tool: 'JOURNAL', family: 'house', capabilityGroups: ['journal'], routes: [/^\/journal(\/|$)/], backupTables: ['journal_entries', 'journal_revisions', 'journal_attachment_references'], mcp: { covers: ['read', 'create', 'update'], note: 'Shared Notes only (archived, not deleted); the private Journal is never reachable.' } },
  { tool: 'GAMIFICATION', family: null, capabilityGroups: [], routes: [], backupTables: [], mcp: { notForAi: 'Points are earned by doing things, never set.' } },
  { tool: 'BRING', family: 'shop', capabilityGroups: ['transfer'], routes: [/^\/bring(\/|$)/], backupTables: ['bring_items'], mcp: { notForAi: 'Bring hands things between Workspaces in person; not offered to AI yet (owner decision open).' } },
  { tool: 'RECIPES', family: 'shop', capabilityGroups: ['recipe'], routes: [/^\/recipes(\/|$)/], backupTables: ['recipes', 'recipe_attachment_references'], mcp: { covers: ALL, note: 'Recipes are archived, not deleted.' } },
  { tool: 'GAZETTE', family: null, capabilityGroups: ['gazette'], routes: [/^\/gazette(\/|$)/], backupTables: ['gazette_settings', 'gazette_editions', 'gazette_watch_items', 'gazette_watch_prices'], mcp: { covers: ALL } },
  {
    tool: 'MAP', family: 'plan', capabilityGroups: ['map'], routes: [/^\/map(\/|$)/],
    backupTables: ['map_approaches', 'map_places', 'map_points', 'map_tags', 'map_place_points', 'map_place_tags'],
    mcp: { covers: ['read', 'create', 'update'], note: 'Shared places are archived in the app; personal visits stay private.' },
  },
] satisfies readonly ToolManifest[]);

/**
 * Backup tables no single tool owns, with the reason. Together with the tools' tables they cover every
 * exported table (a test keeps both lists complete).
 */
export const SHARED_BACKUP_TABLES: Readonly<Record<string, string>> = {
  workspaces: 'the Workspace itself',
  workspace_tools: 'the tool switches',
  memberships: 'the people of the Workspace',
  attachments: 'files shared by Journal and Recipes',
  audit_events: 'the history of every tool',
  links: 'links between records of different tools',
  schedules: 'Procedures and Reminders',
  occurrences: 'Procedures and Reminders',
  occurrence_runs: 'Procedures and Reminders',
  run_documents: 'Procedures and Documents',
  run_document_files: 'Procedures and Documents',
  run_document_removals: 'Procedures and Documents',
};

export function toolManifest(tool: WorkspaceTool): ToolManifest {
  const found = TOOL_MANIFESTS.find((manifest) => manifest.tool === tool);
  if (found === undefined) throw new Error(`No manifest for ${tool}`);
  return found;
}

/** The tool a capability group needs, from the manifests; `null` for structural views. */
export function toolForCapabilityGroup(group: string): WorkspaceTool | null {
  return TOOL_MANIFESTS.find((manifest) => manifest.capabilityGroups.includes(group))?.tool ?? null;
}

/**
 * The tool switches that gate a Workspace API path (the part after `/workspaces/:workspaceId`): one entry
 * per gate, each a set of tools of which at least one must be on. `[]` when no tool owns the path.
 */
export function toolGatesFor(path: string): readonly (readonly WorkspaceTool[])[] {
  const gates = new Map<string, readonly WorkspaceTool[]>();
  for (const manifest of TOOL_MANIFESTS) {
    for (const route of manifest.routes) {
      const [pattern, tools] = route instanceof RegExp ? [route, [manifest.tool]] : [route.pattern, route.anyOf];
      if (pattern.test(path)) gates.set([...tools].sort().join(','), tools);
    }
  }
  return [...gates.values()];
}

/** Tools in `WORKSPACE_TOOLS` order that have a navigation family. */
export const toolsOfFamily = (family: ToolFamily): readonly WorkspaceTool[] =>
  WORKSPACE_TOOLS.filter((tool) => toolManifest(tool).family === family);
