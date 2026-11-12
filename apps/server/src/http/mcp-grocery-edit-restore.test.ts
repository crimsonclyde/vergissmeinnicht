import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.19: update_grocery_items, list_deleted_grocery_items and restore_grocery_items over MCP, and the web's recently deleted view. */
describe('MCP grocery edit, tick and restore', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => {
    await t?.close();
  });

  async function connect(cookie: string, workspaceIds: string[], scopes: McpScope[]) {
    const actor = await t.services.users.findById((await t.get('/api/auth/session', cookie)).json().user.id);
    if (!actor) throw new Error('Missing actor');
    const clientId = randomUUID();
    const redirectUri = 'https://client.example.org/callback';
    await t.services.mcp.registerClient(clientId, { client_name: 'Test assistant' });
    const requestId = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource: ORIGIN + '/mcp' });
    const approved = await t.services.mcp.approve(actor, requestId, workspaceIds, scopes, true);
    const { access_token } = await t.services.mcp.exchange(clientId, String(new URL(approved).searchParams.get('code')), 'code', redirectUri, ORIGIN + '/mcp');
    const rpc = async (method: string, params: object = {}) => {
      const response = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access_token, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method, params } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().result;
    };
    const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[]; structuredContent?: { error: { code: string; itemIds?: string[] } } }>;
    const body = async (name: string, args: object) => {
      const result = await call(name, args);
      expect(result.isError, result.content[0]?.text).not.toBe(true);
      return JSON.parse(result.content[0]?.text ?? 'null');
    };
    const errorCode = async (name: string, args: object) => {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      return result.structuredContent?.error;
    };
    return { rpc, call, body, errorCode };
  }

  async function shopping(workspaceId: string, title: string, items: { title: string; quantity?: string; unit?: string; checked?: boolean }[]) {
    const created = await t.post(`/api/workspaces/${workspaceId}/lists`, { title }, t.admin);
    expect(created.statusCode, created.body).toBe(201);
    const listId = created.json().list.id as string;
    const ids: string[] = [];
    for (const item of items) {
      const added = await t.post(`/api/workspaces/${workspaceId}/lists/${listId}/items`, { title: item.title, quantity: item.quantity ?? null, unit: item.unit ?? null }, t.admin);
      expect(added.statusCode, added.body).toBe(201);
      ids.push(added.json().itemId);
      if (item.checked) expect((await t.post(`/api/workspaces/${workspaceId}/lists/${listId}/items/${added.json().itemId}/check`, { checked: true }, t.admin)).statusCode).toBe(200);
    }
    return { listId, ids };
  }
  const web = async (workspaceId: string, listId: string) => (await t.get(`/api/workspaces/${workspaceId}/lists/${listId}`, t.admin)).json().list;

  it('publishes the tools with schemas and annotations; read-only grants only see deleted items', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const writer = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);
    const initialized = await writer.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(initialized.instructions).toContain('update_grocery_items');
    expect(initialized.instructions).toContain('restore_grocery_items');
    const tools = (await writer.rpc('tools/list')).tools as { name: string; inputSchema: { required: string[]; properties: Record<string, { maxItems?: number }> }; annotations: Record<string, boolean> }[];
    const update = tools.find((tool) => tool.name === 'update_grocery_items');
    const restore = tools.find((tool) => tool.name === 'restore_grocery_items');
    const deleted = tools.find((tool) => tool.name === 'list_deleted_grocery_items');
    expect(update?.inputSchema.required.sort()).toEqual(['expectedRevision', 'items', 'listId', 'operationId', 'workspaceId']);
    expect(update?.inputSchema.properties['items']?.maxItems).toBe(100);
    expect(restore?.inputSchema.required.sort()).toEqual(['expectedRevision', 'itemIds', 'listId', 'operationId', 'workspaceId']);
    expect(update?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(restore?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(deleted?.annotations).toMatchObject({ readOnlyHint: true });

    const reader = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read']);
    const readable = ((await reader.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(readable).toContain('list_deleted_grocery_items');
    expect(readable).not.toContain('update_grocery_items');
    expect(readable).not.toContain('restore_grocery_items');
  });

  it('ticks off what was bought, edits quantities, and restores deleted items, all visible in the web app', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const { listId, ids } = await shopping(workspaceId, 'Weekly shop', [{ title: 'Milk', quantity: '2', unit: 'l' }, { title: 'Eggs' }, { title: 'Bread' }]);
    const [milk, eggs, bread] = ids as [string, string, string];
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write']);

    // "I bought the eggs and the bread, and make the milk 3 litres."
    const read = await assistant.body('get_grocery_list', { workspaceId, listId });
    const request = { workspaceId, listId, expectedRevision: read.revision, operationId: randomUUID(), items: [{ itemId: eggs, checked: true }, { itemId: bread, checked: true }, { itemId: milk, quantity: '3' }] };
    const updated = await assistant.body('update_grocery_items', request);
    expect(updated).toEqual({ outcome: 'UPDATED', duplicate: false, updatedItemIds: [milk, eggs, bread], list: { id: listId, revision: read.revision + 1 } });
    expect((await assistant.body('update_grocery_items', request)).duplicate).toBe(true);
    const afterEdit = await web(workspaceId, listId);
    expect(afterEdit.items.map((item: { title: string; quantity: string | null; checked: unknown }) => [item.title, item.quantity, item.checked !== null])).toEqual([
      ['Milk', '3', false],
      ['Eggs', null, true],
      ['Bread', null, true],
    ]);

    // Delete the bought items, then undo it.
    const deleted = await assistant.body('delete_grocery_items', { workspaceId, listId, itemIds: [eggs, bread], expectedRevision: afterEdit.revision, operationId: randomUUID() });
    const recent = await assistant.body('list_deleted_grocery_items', { workspaceId, listId });
    expect(recent.revision).toBe(deleted.list.revision);
    for (const item of recent.deletedItems as { checked: boolean; deletedBy: string; deletedAt: string }[]) expect(item).toMatchObject({ checked: true, deletedBy: 'Ada', deletedAt: expect.any(String) });
    expect(recent.deletedItems.map((item: { id: string }) => item.id).sort()).toEqual([eggs, bread].sort());
    // The web app shows the same recently deleted items.
    const removed = await t.get(`/api/workspaces/${workspaceId}/lists/${listId}/removed-items`, t.admin);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().items.map((item: { id: string }) => item.id).sort()).toEqual([eggs, bread].sort());
    expect(removed.json().items[0]).toHaveProperty('removedAt');

    const restored = await assistant.body('restore_grocery_items', { workspaceId, listId, itemIds: [bread, eggs], expectedRevision: recent.revision, operationId: randomUUID() });
    expect(restored).toMatchObject({ outcome: 'RESTORED', duplicate: false, restoredItemIds: [eggs, bread] });
    expect((await web(workspaceId, listId)).items.map((item: { id: string }) => item.id)).toEqual([milk, eggs, bread]);
    const history = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type IN ('LIST_ITEMS_UPDATED', 'LIST_ITEMS_RESTORED')").all() as { metadata: string }[];
    expect(history).toHaveLength(2);
    for (const row of history) expect(row.metadata).not.toMatch(/Milk|Eggs|Bread/);
  });

  it('answers refusals with structured codes and changes nothing', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const { listId, ids } = await shopping(workspaceId, 'Weekly shop', [{ title: 'Milk' }, { title: 'Eggs' }]);
    const [milk, eggs] = ids as [string, string];
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write']);
    const revision = (await web(workspaceId, listId)).revision as number;
    const base = { workspaceId, listId, expectedRevision: revision };
    expect(await assistant.errorCode('update_grocery_items', { ...base, operationId: randomUUID(), items: [{ itemId: milk }] })).toMatchObject({ code: 'empty_edit' });
    expect(await assistant.errorCode('update_grocery_items', { ...base, operationId: randomUUID(), items: [{ itemId: milk, checked: true }, { itemId: milk, checked: false }] })).toMatchObject({ code: 'duplicate_item_ids' });
    expect(await assistant.errorCode('update_grocery_items', { ...base, operationId: randomUUID(), items: [{ itemId: milk, quantity: 'lots' }] })).toMatchObject({ code: 'invalid_item_values' });
    expect(await assistant.errorCode('update_grocery_items', { ...base, expectedRevision: revision - 1, operationId: randomUUID(), items: [{ itemId: milk, checked: true }] })).toMatchObject({ code: 'stale_revision' });
    expect(await assistant.errorCode('restore_grocery_items', { ...base, operationId: randomUUID(), itemIds: [eggs] })).toEqual({ code: 'invalid_items', message: expect.any(String), itemIds: [eggs] });
    const items = (await web(workspaceId, listId)).items as { title: string; checked: unknown }[];
    expect(items.map((item) => [item.title, item.checked])).toEqual([['Milk', null], ['Eggs', null]]);
  });
});
