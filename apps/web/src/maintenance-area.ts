import { paths } from './router.tsx';

/**
 * One "Maintenance" area (steps.md 41.2) holds two tools: the Maintenance work and the Equipment it is done
 * on. They stay two tools with their own switches, routes and permissions; the area only remembers which
 * tab a person used last on this device, so a single menu entry can open it again.
 */
export type MaintenanceTab = 'maintenance' | 'equipment';

const key = (workspaceId: string) => `vmn.maintenanceTab.${workspaceId}`;

export function lastMaintenanceTab(workspaceId: string): MaintenanceTab | null {
  try {
    const saved = window.localStorage.getItem(key(workspaceId));
    return saved === 'maintenance' || saved === 'equipment' ? saved : null;
  } catch {
    return null;
  }
}

export function rememberMaintenanceTab(workspaceId: string, tab: MaintenanceTab): void {
  try {
    window.localStorage.setItem(key(workspaceId), tab);
  } catch {
    // A convenience only.
  }
}

/** The tabs a Workspace shows: each only while its tool is on. */
export function maintenanceTabs(tools: readonly string[]): MaintenanceTab[] {
  return [...(tools.includes('MAINTENANCE') ? ['maintenance' as const] : []), ...(tools.includes('EQUIPMENT') ? ['equipment' as const] : [])];
}

/** Where the one menu entry leads: the last-used tab while its tool is on, else the first that is; null if neither is on. */
export function maintenanceAreaHref(workspaceId: string, tools: readonly string[]): string | null {
  const tabs = maintenanceTabs(tools);
  const last = lastMaintenanceTab(workspaceId);
  const tab = last !== null && tabs.includes(last) ? last : tabs[0];
  if (tab === undefined) return null;
  return tab === 'equipment' ? paths.equipment(workspaceId) : paths.maintenance(workspaceId);
}
