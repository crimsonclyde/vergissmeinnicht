import { describe, expect, it } from 'vitest';
import { TOOL_MANIFESTS, WORKSPACE_TOOLS } from '@vergissmeinnicht/domain';
import { TOOL_PLUGINS } from './tool-registry.ts';

describe('tool registry', () => {
  it('lists every switchable Workspace tool exactly once', () => {
    expect(TOOL_PLUGINS.map((plugin) => plugin.tool).sort()).toEqual([...WORKSPACE_TOOLS].sort());
  });
  it('asks before switching off the tools that send notifications', () => {
    expect(TOOL_PLUGINS.filter((plugin) => plugin.confirmOff === true).map((plugin) => plugin.tool)).toEqual(['PROCEDURES', 'REMINDERS']);
  });
  it('gives a navigation page to exactly the tools whose manifest has a family (45.7)', () => {
    for (const manifest of TOOL_MANIFESTS) {
      const plugin = TOOL_PLUGINS.find((entry) => entry.tool === manifest.tool);
      expect(plugin?.page !== undefined, manifest.tool).toBe(manifest.family !== null);
    }
  });
});
