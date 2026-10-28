import { orderedNavigationTools, type NavigationTool } from '@vergissmeinnicht/domain';
import { t } from './i18n/index.ts';
import { paths, type Route } from './router.tsx';
import type { UiIconName } from './ui-icons.tsx';

export interface Destination {
  readonly href: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Pages on which this destination is the current one. */
  readonly pages: readonly Route['page'][];
}

/**
 * The tools (15.1). Desktop sidebar: Today, Procedures, Reminders, Lists, Calendar. Phone bottom bar:
 * Today, Procedures, Lists and More — More leads to Reminders, Calendar and the completed history.
 * `tools`: the optional tools the Workspace has switched on (UI only; every request is checked).
 */
export function destinations(workspaceId: string, tools: readonly string[] = [], order: readonly NavigationTool[] | null = null): { side: Destination[]; bar: Destination[] } {
  const today: Destination = { href: paths.home(workspaceId), label: t('shell.today'), icon: 'today', pages: ['workspace'] };
  const procedures: Destination = { href: paths.procedures(workspaceId), label: t('shell.procedures'), icon: 'procedures', pages: ['procedures', 'procedure-edit', 'photos'] };
  const reminders: Destination = { href: paths.reminders(workspaceId), label: t('shell.reminders'), icon: 'reminders', pages: ['reminders'] };
  const lists: Destination = { href: paths.lists(workspaceId), label: t('shell.lists'), icon: 'lists', pages: ['lists'] };
  const calendar: Destination = { href: paths.calendar(workspaceId), label: t('shell.calendar'), icon: 'calendar', pages: ['calendar'] };
  const documents: Destination = { href: paths.documents(workspaceId), label: t('shell.documents'), icon: 'documents', pages: ['documents'] };
  const contacts: Destination = { href: paths.contacts(workspaceId), label: t('shell.contacts'), icon: 'contacts', pages: ['contacts'] };
  const maintenance: Destination = { href: paths.maintenance(workspaceId), label: t('shell.maintenance'), icon: 'maintenance', pages: ['maintenance'] };
  const equipment:Destination={href:paths.equipment(workspaceId),label:t('shell.equipment'),icon:'equipment',pages:['equipment']};
  const bring: Destination = { href: paths.bring(workspaceId), label: t('bring.heading'), icon: 'forward', pages: ['bring'] };
  const journal: Destination = { href: paths.journal(workspaceId), label: t('journal.heading'), icon: 'documents', pages: ['journal'] };
  const optional = [...(tools.includes('BRING') ? [bring] : []),...(tools.includes('JOURNAL') ? [journal] : []),...(tools.includes('DOCUMENTS') ? [documents] : []), ...(tools.includes('CONTACTS') ? [contacts] : []), ...(tools.includes('MAINTENANCE') ? [maintenance] : []),...(tools.includes('EQUIPMENT') ? [equipment]:[])];
  const more: Destination = { href: paths.more(workspaceId), label: t('shell.more'), icon: 'more', pages: ['more', 'reminders', 'calendar', 'history', ...optional.flatMap((tool) => tool.pages)] };
  if (order !== null) {
    const registry: Record<NavigationTool, Destination> = { PROCEDURES: procedures, LISTS: lists, REMINDERS: reminders, CALENDAR: calendar, JOURNAL: journal, DOCUMENTS: documents, CONTACTS: contacts, MAINTENANCE: maintenance, EQUIPMENT: equipment, BRING: bring };
    const sorted = orderedNavigationTools(order).filter(tool => tools.includes(tool)).map(tool => registry[tool]);
    const pinned = sorted.slice(0, 2);
    return { side: [today, ...sorted], bar: [today, ...pinned, { ...more, pages: ['more', 'history', ...sorted.slice(2).flatMap(item => item.pages)] }] };
  }
  return { side: [today, ...(tools.includes('PROCEDURES') ? [procedures] : []), ...(tools.includes('REMINDERS') ? [reminders] : []), ...(tools.includes('LISTS') ? [lists] : []), ...(tools.includes('CALENDAR') ? [calendar] : []), ...optional], bar: [today, ...(tools.includes('PROCEDURES') ? [procedures] : []), ...(tools.includes('LISTS') ? [lists] : []), more] };
}
