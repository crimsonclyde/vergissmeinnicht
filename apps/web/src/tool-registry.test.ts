import { describe, expect, it } from 'vitest';
import { WORKSPACE_TOOLS } from '@vergissmeinnicht/domain';
import { TOOL_PLUGINS } from './tool-registry.ts';

describe('tool registry', () => {
  it('lists every switchable Workspace tool exactly once', () => {
    expect(TOOL_PLUGINS.map((plugin) => plugin.tool).sort()).toEqual([...WORKSPACE_TOOLS].sort());
  });
  it('asks before switching off the tools that send notifications', () => {
    expect(TOOL_PLUGINS.filter((plugin) => plugin.confirmOff === true).map((plugin) => plugin.tool)).toEqual(['PROCEDURES', 'REMINDERS']);
  });
});
