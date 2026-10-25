import type { UiIconName } from './ui-icons.tsx';
import { t } from './i18n/index.ts';

/**
 * The switchable tools of a Workspace, in the order the Plugins tab shows them: one entry per tool with
 * its icon and texts. New tools register here instead of in each settings page. Bundled, reviewed code
 * only: nothing is ever loaded at runtime, and the server still authorizes every request.
 */
export interface ToolPlugin {
  readonly tool: string;
  readonly icon: UiIconName;
  readonly name: () => string;
  readonly hint: () => string;
  /** Switching off stops scheduled notifications, so it asks first. */
  readonly confirmOff?: boolean;
}

export const TOOL_PLUGINS: readonly ToolPlugin[] = [
  { tool: 'PROCEDURES', icon: 'procedures', name: () => t('shell.procedures'), hint: () => t('tools.proceduresHint'), confirmOff: true },
  { tool: 'REMINDERS', icon: 'reminders', name: () => t('shell.reminders'), hint: () => t('tools.remindersHint'), confirmOff: true },
  { tool: 'LISTS', icon: 'lists', name: () => t('shell.lists'), hint: () => t('more.listsHint') },
  { tool: 'CALENDAR', icon: 'calendar', name: () => t('shell.calendar'), hint: () => t('more.calendarHint') },
  { tool: 'DOCUMENTS', icon: 'documents', name: () => t('tools.documents'), hint: () => t('tools.documentsHint') },
  { tool: 'CONTACTS', icon: 'contacts', name: () => t('tools.contacts'), hint: () => t('tools.contactsHint') },
  { tool: 'MAINTENANCE', icon: 'maintenance', name: () => t('tools.maintenance'), hint: () => t('tools.maintenanceHint') },
  { tool: 'EQUIPMENT', icon: 'equipment', name: () => t('shell.equipment'), hint: () => t('tools.equipmentHint') },
  { tool: 'JOURNAL', icon: 'journal', name: () => t('journal.heading'), hint: () => t('journal.toolHint') },
  { tool: 'GAMIFICATION', icon: 'star', name: () => t('gamification.heading'), hint: () => t('gamification.toolHint') },
  { tool: 'MOON', icon: 'moon', name: () => t('moon.heading'), hint: () => t('moon.toolHint') },
];
