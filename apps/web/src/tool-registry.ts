import type { WorkspaceTool } from '@vergissmeinnicht/domain';
import type { UiIconName } from './ui-icons.tsx';
import { t } from './i18n/index.ts';
import { maintenanceAreaHref } from './maintenance-area.ts';
import { paths, type Route } from './router.tsx';

/** A page of a tool in the navigation (45.7). */
export interface ToolPage {
  readonly href: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Pages on which this destination is the current one. */
  readonly pages: readonly Route['page'][];
}

/**
 * The web half of a tool's manifest (45.7; the shared half is `TOOL_MANIFESTS` in the domain): the
 * switchable tools of a Workspace, in the order the Plugins tab shows them, with icon, texts and the page
 * the navigation opens. Bundled, reviewed code only: nothing is ever loaded at runtime, and the server
 * still authorizes every request.
 */
export interface ToolPlugin {
  readonly tool: WorkspaceTool;
  readonly icon: UiIconName;
  readonly name: () => string;
  readonly hint: () => string;
  /** Switching off stops scheduled notifications, so it asks first. */
  readonly confirmOff?: boolean;
  /** Its page in the navigation; tools without a navigation family (`TOOL_MANIFESTS`) have none. */
  readonly page?: (workspaceId: string, tools: readonly string[]) => ToolPage;
}

// Equipment and Maintenance are one area (41.2): one entry, opening the tab used last.
const maintenanceArea = (workspaceId: string, tools: readonly string[]): ToolPage => ({ href: maintenanceAreaHref(workspaceId, tools) ?? paths.maintenance(workspaceId), label: t('shell.maintenance'), icon: 'maintenance', pages: ['maintenance', 'equipment'] });

export const TOOL_PLUGINS: readonly ToolPlugin[] = [
  {tool:'RECIPES',icon:'grocery',name:()=>t('recipes.heading'),hint:()=>t('recipes.hint'), page:(w)=>({href:paths.recipes(w),label:t('recipes.heading'),icon:'grocery',pages:['recipes']}) },
  { tool: 'PROCEDURES', icon: 'procedures', name: () => t('shell.procedures'), hint: () => t('tools.proceduresHint'), confirmOff: true, page: (w) => ({ href: paths.procedures(w), label: t('shell.procedures'), icon: 'procedures', pages: ['procedures', 'procedure-edit', 'photos'] }) },
  { tool: 'REMINDERS', icon: 'reminders', name: () => t('shell.reminders'), hint: () => t('tools.remindersHint'), confirmOff: true, page: (w) => ({ href: paths.reminders(w), label: t('shell.reminders'), icon: 'reminders', pages: ['reminders'] }) },
  { tool: 'LISTS', icon: 'lists', name: () => t('shell.lists'), hint: () => t('more.listsHint'), page: (w) => ({ href: paths.lists(w), label: t('shell.lists'), icon: 'lists', pages: ['lists'] }) },
  { tool: 'CALENDAR', icon: 'calendar', name: () => t('shell.calendar'), hint: () => t('more.calendarHint'), page: (w) => ({ href: paths.calendar(w), label: t('shell.calendar'), icon: 'calendar', pages: ['calendar'] }) },
  { tool: 'DOCUMENTS', icon: 'documents', name: () => t('tools.documents'), hint: () => t('tools.documentsHint'), page: (w) => ({ href: paths.documents(w), label: t('shell.documents'), icon: 'documents', pages: ['documents'] }) },
  { tool: 'CONTACTS', icon: 'contacts', name: () => t('tools.contacts'), hint: () => t('tools.contactsHint'), page: (w) => ({ href: paths.contacts(w), label: t('shell.contacts'), icon: 'contacts', pages: ['contacts'] }) },
  { tool: 'MAINTENANCE', icon: 'maintenance', name: () => t('tools.maintenance'), hint: () => t('tools.maintenanceHint'), page: maintenanceArea },
  { tool: 'EQUIPMENT', icon: 'equipment', name: () => t('shell.equipment'), hint: () => t('tools.equipmentHint'), page: maintenanceArea },
  { tool: 'BRING', icon: 'forward', name: () => t('bring.heading'), hint: () => t('bring.hint'), page: (w) => ({ href: paths.bring(w), label: t('bring.heading'), icon: 'forward', pages: ['bring'] }) },
  { tool: 'JOURNAL', icon: 'journal', name: () => t('journal.heading'), hint: () => t('journal.toolHint'), page: (w) => ({ href: paths.journal(w), label: t('journal.heading'), icon: 'notebook', pages: ['journal'] }) },
  { tool: 'GAMIFICATION', icon: 'star', name: () => t('gamification.heading'), hint: () => t('gamification.toolHint') },
  { tool: 'MAP', icon: 'gazetteMap', name: () => t('map.navigation'), hint: () => t('map.toolHint'), page: (w) => ({ href: paths.map(w), label: t('map.navigation'), icon: 'gazetteMap', pages: ['map'] }) },
  { tool: 'GAZETTE', icon: 'gazette', name: () => t('gazette.heading'), hint: () => t('gazette.toolHint') },
  { tool: 'MOON', icon: 'moon', name: () => t('moon.heading'), hint: () => t('moon.toolHint') },
];

/** The web manifest of a tool. */
export function toolPlugin(tool: WorkspaceTool): ToolPlugin {
  const found = TOOL_PLUGINS.find((plugin) => plugin.tool === tool);
  if (found === undefined) throw new Error(`No plugin for ${tool}`);
  return found;
}
