import { describe, expect, it } from 'vitest';
import { MCP_SCOPES, TOOL_MANIFESTS, WORKSPACE_TOOLS, type McpAction } from '@vergissmeinnicht/domain';
import { assistantTools } from './tools.ts';

/** The action of an MCP tool, read from its name: every tool name starts with one of these verbs. */
const VERBS: Readonly<Record<string, McpAction>> = {
  list: 'read', get: 'read', search: 'read', scale: 'read', preview: 'read',
  create: 'create', add: 'create', import: 'create', start: 'create', schedule: 'create', publish: 'create', prepare: 'create', transfer: 'create', open: 'create', upload: 'create',
  update: 'update', save: 'update', set: 'update', complete: 'update', skip: 'update', reopen: 'update', move: 'update', rename: 'update', restore: 'update', record: 'update',
  delete: 'delete', archive: 'delete', abort: 'delete',
};
const actionOf = (name: string): McpAction | undefined => VERBS[name.split('_')[0] ?? ''];

/**
 * MCP coverage (48.2): every Workspace tool says in its manifest what AI assistants can do with it, and
 * this test holds the MCP tools to it. A new feature therefore gets AI tools, or an explicit reason why not.
 */
describe('MCP coverage of the Workspace tools', () => {
  it('names every MCP tool with a known verb and a unique name', () => {
    expect(assistantTools.filter((tool) => actionOf(tool.name) === undefined).map((tool) => tool.name)).toEqual([]);
    expect(new Set(assistantTools.map((tool) => tool.name)).size).toBe(assistantTools.length);
  });

  it('has a tool for every action a manifest promises, and none for a tool that is not for AI', () => {
    for (const manifest of TOOL_MANIFESTS) {
      const tools = assistantTools.filter((tool) => tool.tool === manifest.tool);
      if ('notForAi' in manifest.mcp) {
        expect({ tool: manifest.tool, reason: manifest.mcp.notForAi.length > 10, mcpTools: tools.map((tool) => tool.name) }).toEqual({ tool: manifest.tool, reason: true, mcpTools: [] });
        continue;
      }
      for (const action of manifest.mcp.covers) {
        expect({ tool: manifest.tool, action, covered: tools.some((tool) => actionOf(tool.name) === action) }).toEqual({ tool: manifest.tool, action, covered: true });
      }
    }
    expect(TOOL_MANIFESTS.map((manifest) => manifest.tool).sort()).toEqual([...WORKSPACE_TOOLS].sort());
  });

  it('marks reading tools read-only, changing tools as writes under a write scope, and deletions as destructive', () => {
    for (const tool of assistantTools) {
      const action = actionOf(tool.name);
      const row = { name: tool.name, write: tool.write, scope: [tool.scope, ...(tool.extraScopes ?? [])].some((scope) => scope.endsWith('.write')), destructive: tool.destructive === true };
      // A read may sit under a write scope where the area has no read scope (List covers).
      if (action === 'read') expect(row).toMatchObject({ write: false });
      else expect(row).toMatchObject({ write: true, scope: true });
      if (tool.name.startsWith('delete_') || tool.name.startsWith('abort_')) expect(row).toMatchObject({ destructive: true });
      expect(MCP_SCOPES).toContain(tool.scope);
    }
  });
});
