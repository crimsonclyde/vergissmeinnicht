import { describe, expect, it } from 'vitest';
import { WORKSPACE_TOOLS } from './document.ts';
import { NAVIGATION_TOOLS } from './preferences.ts';
import { SHARED_BACKUP_TABLES, TOOL_MANIFESTS, toolForCapabilityGroup, toolGatesFor, toolsOfFamily } from './tool-manifest.ts';

describe('tool manifests (45.7–45.9)', () => {
  it('describe every tool exactly once', () => {
    expect(TOOL_MANIFESTS.map((manifest) => manifest.tool).sort()).toEqual([...WORKSPACE_TOOLS].sort());
  });
  it('put exactly the navigable tools into a navigation family', () => {
    expect(TOOL_MANIFESTS.filter((manifest) => manifest.family !== null).map((manifest) => manifest.tool).sort()).toEqual([...NAVIGATION_TOOLS].sort());
    expect(toolsOfFamily('shop')).toEqual(['LISTS', 'BRING', 'RECIPES']);
  });
  it('give each capability group and backup table at most one owner', () => {
    const groups = TOOL_MANIFESTS.flatMap((manifest) => manifest.capabilityGroups);
    expect(new Set(groups).size).toBe(groups.length);
    const tables = [...TOOL_MANIFESTS.flatMap((manifest) => manifest.backupTables), ...Object.keys(SHARED_BACKUP_TABLES)];
    expect(new Set(tables).size).toBe(tables.length);
    expect(toolForCapabilityGroup('equipment')).toBe('EQUIPMENT');
    expect(toolForCapabilityGroup('workspace')).toBeNull();
  });
  it('gate shared and combined routes', () => {
    expect(toolGatesFor('/equipment/:recordId')).toEqual([['EQUIPMENT']]);
    expect(toolGatesFor('/schedules/:scheduleId')).toEqual([['PROCEDURES', 'REMINDERS']]);
    expect(toolGatesFor('/runs/:runId/documents')).toEqual([['PROCEDURES'], ['DOCUMENTS']]);
    expect(toolGatesFor('/recipes/:recipeId/shopping')).toEqual([['LISTS'], ['RECIPES']]);
    expect(toolGatesFor('/members')).toEqual([]);
  });
});
