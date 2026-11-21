import { orderedNavigationTools, toolsOfFamily, type NavigationTool, type ToolFamily } from '@vergissmeinnicht/domain';
import { t, type MessageKey } from './i18n/index.ts';
import { paths, type Route } from './router.tsx';
import { toolPlugin } from './tool-registry.ts';
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
  readonly news: Destination | null;
  /** The enabled tools in the person's order (the classic sidebar). */
  readonly tools: readonly Destination[];
  /** The same tools sorted into families, each family in the person's order; empty families are left out. */
  readonly groups: readonly NavigationGroup[];
  /** The phone bar: Today and the first two enabled tools of the person's order. The Tools button follows. */
  readonly bar: readonly Destination[];
}

/**
 * The families (section 42): one list for the desktop menu bar, the classic sidebar and the phone drawer.
 * Which tool belongs to which family is part of its manifest (`TOOL_MANIFESTS`, 45.7).
 */
const FAMILIES: readonly { readonly id: ToolFamily; readonly label: MessageKey; readonly icon: UiIconName }[] = [
  { id: 'plan', label: 'navigation.groupPlan', icon: 'plan' },
  { id: 'shop', label: 'navigation.groupShop', icon: 'shop' },
  { id: 'house', label: 'navigation.groupHouse', icon: 'house' },
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

/** The tool's page from its web manifest (45.7). */
function toolDestination(workspaceId: string, tool: NavigationTool, tools: readonly string[]): Destination {
  const page = toolPlugin(tool).page;
  if (page === undefined) throw new Error(`${tool} has no navigation page`);
  return page(workspaceId, tools);
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
      ...destinationsOf(workspaceId, tools, enabled.filter(tool => toolsOfFamily(family.id).includes(tool))),
      // The completed history looks back on executed Procedures, so it is there only with Procedures.
      ...(family.id === 'plan' && tools.includes('PROCEDURES') ? [history] : []),
    ],
  }));
  const news: Destination | null = tools.includes('GAZETTE')
    ? { href: paths.gazette(workspaceId), label: t('gazette.news'), icon: 'gazette', pages: ['gazette'] }
    : null;
  const instruments: NavigationGroup = {
    id: 'instruments',
    label: t('navigation.groupInstruments'),
    icon: 'clock',
    items: [
      ...(news ? [news] : []),
      { href: paths.weather(), label: t('weather.heading'), icon: 'weatherStatus', pages: ['weather'] },
      { href: paths.clock(), label: t('navigation.clock'), icon: 'clock', pages: ['clock'] },
    ],
  };
  return {
    today,
    news,
    tools: destinationsOf(workspaceId, tools, enabled),
    groups: [...groups.filter(group => group.items.length > 0), instruments],
    bar: [today, ...destinationsOf(workspaceId, tools, enabled).slice(0, 2)],
  };
}

/** True when the page belongs to one of the destinations. */
export function isCurrent(items: readonly Destination[], page: Route['page']): boolean {
  return items.some(item => item.pages.includes(page));
}
