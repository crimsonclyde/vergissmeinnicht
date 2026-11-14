import { orderedNavigationTools, type NavigationTool } from '@vergissmeinnicht/domain';
import { t, type MessageKey } from './i18n/index.ts';
import { maintenanceAreaHref } from './maintenance-area.ts';
import { paths, type Route } from './router.tsx';
import type { UiIconName } from './ui-icons.tsx';

export interface Destination {
  readonly href: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Pages on which this destination is the current one. */
  readonly pages: readonly Route['page'][];
}

export type NavigationGroupId = 'plan' | 'shop' | 'house' | 'instruments';

/** One family of destinations: a menu of the desktop menu bar and a row of the phone drawer. */
export interface NavigationGroup {
  readonly id: NavigationGroupId;
  readonly label: string;
  readonly icon: UiIconName;
  readonly items: readonly Destination[];
}

export interface Navigation {
  readonly today: Destination;
  /** The enabled tools in the person's order (the classic sidebar). */
  readonly tools: readonly Destination[];
  /** The same tools sorted into families, each family in the person's order; empty families are left out. */
  readonly groups: readonly NavigationGroup[];
  /** The phone bar: Today and the first two enabled tools of the person's order. The Tools button follows. */
  readonly bar: readonly Destination[];
}

/** The families (section 42): one list for the desktop menu bar, the classic sidebar and the phone drawer. */
const FAMILIES: readonly { readonly id: Exclude<NavigationGroupId, 'instruments'>; readonly label: MessageKey; readonly icon: UiIconName; readonly tools: readonly NavigationTool[] }[] = [
  { id: 'plan', label: 'navigation.groupPlan', icon: 'plan', tools: ['PROCEDURES', 'REMINDERS', 'CALENDAR'] },
  { id: 'shop', label: 'navigation.groupShop', icon: 'shop', tools: ['LISTS', 'RECIPES', 'BRING'] },
  { id: 'house', label: 'navigation.groupHouse', icon: 'house', tools: ['EQUIPMENT', 'MAINTENANCE', 'DOCUMENTS', 'CONTACTS', 'JOURNAL'] },
];

/** Enabled tools as destinations, in order; tools that share one area appear once. */
function destinationsOf(workspaceId: string, tools: readonly string[], list: readonly NavigationTool[]): Destination[] {
  const result: Destination[] = [];
  for (const tool of list) {
    const item = toolDestination(workspaceId, tool, tools);
    if (!result.some(other => other.pages[0] === item.pages[0])) result.push(item);
  }
  return result;
}

function toolDestination(workspaceId: string, tool: NavigationTool, tools: readonly string[]): Destination {
  switch (tool) {
    case 'PROCEDURES': return { href: paths.procedures(workspaceId), label: t('shell.procedures'), icon: 'procedures', pages: ['procedures', 'procedure-edit', 'photos'] };
    case 'REMINDERS': return { href: paths.reminders(workspaceId), label: t('shell.reminders'), icon: 'reminders', pages: ['reminders'] };
    case 'LISTS': return { href: paths.lists(workspaceId), label: t('shell.lists'), icon: 'lists', pages: ['lists'] };
    case 'CALENDAR': return { href: paths.calendar(workspaceId), label: t('shell.calendar'), icon: 'calendar', pages: ['calendar'] };
    case 'DOCUMENTS': return { href: paths.documents(workspaceId), label: t('shell.documents'), icon: 'documents', pages: ['documents'] };
    case 'CONTACTS': return { href: paths.contacts(workspaceId), label: t('shell.contacts'), icon: 'contacts', pages: ['contacts'] };
    // Equipment and Maintenance are one area (41.2): one entry, opening the tab used last.
    case 'MAINTENANCE':
    case 'EQUIPMENT': return { href: maintenanceAreaHref(workspaceId, tools) ?? paths.maintenance(workspaceId), label: t('shell.maintenance'), icon: 'maintenance', pages: ['maintenance', 'equipment'] };
    case 'RECIPES': return { href: paths.recipes(workspaceId), label: t('recipes.heading'), icon: 'grocery', pages: ['recipes'] };
    case 'BRING': return { href: paths.bring(workspaceId), label: t('bring.heading'), icon: 'forward', pages: ['bring'] };
    case 'JOURNAL': return { href: paths.journal(workspaceId), label: t('journal.heading'), icon: 'notebook', pages: ['journal'] };
  }
}

/**
 * The tools of a Workspace (sections 15.1, 42). `tools`: the optional tools the Workspace has switched on
 * (UI only; every request is still checked by the server). `order`: the person's saved order; it decides
 * the two phone favourites and the order inside each family.
 */
export function navigation(workspaceId: string, tools: readonly string[] = [], order: readonly NavigationTool[] | null = null): Navigation {
  const today: Destination = { href: paths.home(workspaceId), label: t('shell.today'), icon: 'today', pages: ['workspace'] };
  const enabled = orderedNavigationTools(order).filter(tool => tools.includes(tool));
  const history: Destination = { href: paths.history(workspaceId), label: t('shell.history'), icon: 'history', pages: ['history', 'schedule-history'] };
  const groups: NavigationGroup[] = FAMILIES.map(family => ({
    id: family.id,
    label: t(family.label),
    icon: family.icon,
    items: [
      ...destinationsOf(workspaceId, tools, enabled.filter(tool => family.tools.includes(tool))),
      // The completed history looks back on executed Procedures, so it is there only with Procedures.
      ...(family.id === 'plan' && tools.includes('PROCEDURES') ? [history] : []),
    ],
  }));
  const instruments: NavigationGroup = {
    id: 'instruments',
    label: t('navigation.groupInstruments'),
    icon: 'clock',
    items: [
      // The Daily Planet (43.2) is read, not managed: it sits with the other daily instruments.
      ...(tools.includes('GAZETTE') ? [{ href: paths.gazette(workspaceId), label: t('gazette.heading'), icon: 'gazette' as const, pages: ['gazette' as const] }] : []),
      { href: paths.weather(), label: t('weather.heading'), icon: 'weatherStatus', pages: ['weather'] },
      { href: paths.clock(), label: t('navigation.clock'), icon: 'clock', pages: ['clock'] },
    ],
  };
  return {
    today,
    tools: destinationsOf(workspaceId, tools, enabled),
    groups: [...groups.filter(group => group.items.length > 0), instruments],
    bar: [today, ...destinationsOf(workspaceId, tools, enabled).slice(0, 2)],
  };
}

/** True when the page belongs to one of the destinations. */
export function isCurrent(items: readonly Destination[], page: Route['page']): boolean {
  return items.some(item => item.pages.includes(page));
}
