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

export interface ToolManifest {
  readonly tool: WorkspaceTool;
  /** Where the tool appears in the navigation; `null` for tools without a page of their own in it. */
  readonly family: ToolFamily | null;
  /** Capability groups (`equipment` of `equipment.view`) that need this tool switched on. */
  readonly capabilityGroups: readonly string[];
  readonly routes: readonly ToolRoute[];
  /** Workspace backup tables that hold this tool's records. */
  readonly backupTables: readonly string[];
}

const SCHEDULES: ToolRoute = { pattern: /^\/(schedules|occurrences)(\/|$)/, anyOf: ['PROCEDURES', 'REMINDERS'] };

export const TOOL_MANIFESTS: readonly ToolManifest[] = Object.freeze([
  {
    tool: 'PROCEDURES', family: 'plan', capabilityGroups: ['procedure', 'run', 'knot'],
    routes: [/^\/(procedures|runs|knots|images)(\/|$)/, SCHEDULES],
    backupTables: ['step_images', 'procedures', 'procedure_sections', 'procedure_steps', 'runs', 'run_sections', 'run_steps'],
  },
  { tool: 'REMINDERS', family: 'plan', capabilityGroups: [], routes: [SCHEDULES], backupTables: [] },
  { tool: 'LISTS', family: 'shop', capabilityGroups: ['list'], routes: [/^\/lists(\/|$)/, /^\/recipes\/:recipeId\/shopping$/], backupTables: ['lists', 'list_items'] },
  { tool: 'CALENDAR', family: 'plan', capabilityGroups: [], routes: [/^\/(calendar|calendar-feed)(\/|$)/], backupTables: [] },
  {
    tool: 'DOCUMENTS', family: 'house', capabilityGroups: ['document'],
    routes: [/^\/(documents|document-files|document-folders|document-types|document-links|text-recognition)(\/|$)/, /^\/runs\/:runId\/documents/],
    backupTables: ['document_types', 'document_folders', 'document_files', 'documents', 'document_pages', 'document_file_texts', 'document_suggestion_dismissals'],
  },
  { tool: 'CONTACTS', family: 'house', capabilityGroups: ['contact'], routes: [/^\/(contacts|contact-links)(\/|$)/], backupTables: ['contacts'] },
  { tool: 'MAINTENANCE', family: 'house', capabilityGroups: ['maintenance'], routes: [/^\/(maintenance|maintenance-links)(\/|$)/], backupTables: ['maintenance_records'] },
  { tool: 'EQUIPMENT', family: 'house', capabilityGroups: ['equipment'], routes: [/^\/(equipment|equipment-links)(\/|$)/], backupTables: ['equipment_records'] },
  { tool: 'MOON', family: null, capabilityGroups: [], routes: [/^\/moon$/], backupTables: [] },
  { tool: 'JOURNAL', family: 'house', capabilityGroups: ['journal'], routes: [/^\/journal(\/|$)/], backupTables: ['journal_entries', 'journal_revisions', 'journal_attachment_references'] },
  { tool: 'GAMIFICATION', family: null, capabilityGroups: [], routes: [], backupTables: [] },
  { tool: 'BRING', family: 'shop', capabilityGroups: ['transfer'], routes: [/^\/bring(\/|$)/], backupTables: ['bring_items'] },
  { tool: 'RECIPES', family: 'shop', capabilityGroups: ['recipe'], routes: [/^\/recipes(\/|$)/], backupTables: ['recipes', 'recipe_attachment_references'] },
  { tool: 'GAZETTE', family: null, capabilityGroups: ['gazette'], routes: [/^\/gazette(\/|$)/], backupTables: ['gazette_settings', 'gazette_editions', 'gazette_watch_items', 'gazette_watch_prices'] },
  {
    tool: 'MAP', family: 'plan', capabilityGroups: ['map'], routes: [/^\/map(\/|$)/],
    backupTables: ['map_approaches', 'map_places', 'map_points', 'map_tags', 'map_place_points', 'map_place_tags'],
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
