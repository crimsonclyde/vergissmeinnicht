import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.18: move_grocery_items and delete_grocery_items over the existing OAuth MCP connection. */
describe('MCP grocery move and delete', () => {
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
  const overview = async (workspaceId: string) => (await t.get(`/api/workspaces/${workspaceId}/lists`, t.admin)).json().lists as { id: string; revision: number; open: number; checked: number }[];

  it('publishes both tools with schemas, annotations and approval guidance, only to grocery write grants', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const writer = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);
    const initialized = await writer.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(initialized.instructions).toContain('Never use add_grocery_item plus delete_grocery_items to move items');
    expect(initialized.instructions).toContain('do not ask again after an explicit approval');

    const tools = (await writer.rpc('tools/list')).tools as { name: string; description: string; inputSchema: { required: string[]; properties: Record<string, { maxItems?: number }> }; annotations: Record<string, boolean> }[];
    const move = tools.find((tool) => tool.name === 'move_grocery_items');
    const remove = tools.find((tool) => tool.name === 'delete_grocery_items');
    expect(move?.inputSchema.required.sort()).toEqual(['destinationListId', 'expectedDestinationRevision', 'expectedSourceRevision', 'itemIds', 'operationId', 'sourceListId', 'workspaceId']);
    expect(remove?.inputSchema.required.sort()).toEqual(['expectedRevision', 'itemIds', 'listId', 'operationId', 'workspaceId']);
    expect(move?.inputSchema.properties['itemIds']?.maxItems).toBe(100);
    expect(move?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(remove?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(move?.description).toContain('wait for approval');
    expect(remove?.description).toContain('wait for explicit approval');

    const reader = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read']);
    const readable = ((await reader.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(readable).toContain('get_grocery_list');
    expect(readable).not.toContain('move_grocery_items');
    expect(readable).not.toContain('delete_grocery_items');
  });

  it('moves four items from Shopping to Vario in one call, without duplicates or lost data, and the web app shows it', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const source = await shopping(workspace, 'Shopping', [
      { title: 'Milk', quantity: '2', unit: 'l' },
      { title: 'Eggs', quantity: '10', checked: true },
      { title: 'Flour', quantity: '1', unit: 'kg' },
      { title: 'Basil' },
      { title: 'Coffee', quantity: '500', unit: 'g' },
    ]);
    const vario = await shopping(workspace, 'Vario', []);
    const mcp = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);

    // Read-only inspection changes nothing.
    const before = await mcp.body('get_grocery_list', { workspaceId: workspace, listId: source.listId });
    const destination = await mcp.body('get_grocery_list', { workspaceId: workspace, listId: vario.listId });
    expect((await web(workspace, source.listId)).revision).toBe(before.revision);
    expect((await mcp.body('list_grocery_lists', { workspaceId: workspace })).lists).toEqual(expect.arrayContaining([expect.objectContaining({ id: source.listId, revision: before.revision }), expect.objectContaining({ id: vario.listId, revision: destination.revision })]));

    const four = source.ids.slice(0, 4);
    const request = { workspaceId: workspace, sourceListId: source.listId, destinationListId: vario.listId, itemIds: four, operationId: randomUUID(), expectedSourceRevision: before.revision, expectedDestinationRevision: destination.revision };
    const moved = await mcp.body('move_grocery_items', request);
    expect(moved).toEqual({
      outcome: 'MOVED',
      duplicate: false,
      movedItemIds: four,
      sourceList: { id: source.listId, revision: before.revision + 1 },
      destinationList: { id: vario.listId, revision: destination.revision + 1 },
    });
    // The lost-answer retry repeats the answer; nothing moves twice.
    expect(await mcp.body('move_grocery_items', request)).toEqual({ ...moved, duplicate: true });

    const after = await web(workspace, vario.listId);
    expect(after.revision).toBe(destination.revision + 1);
    expect(after.items.map((item: { id: string; title: string; quantity: string | null; unit: string | null; checked: unknown }) => ({ id: item.id, title: item.title, quantity: item.quantity, unit: item.unit, checked: item.checked !== null }))).toEqual([
      { id: four[0], title: 'Milk', quantity: '2', unit: 'l', checked: false },
      { id: four[1], title: 'Eggs', quantity: '10', unit: null, checked: true },
      { id: four[2], title: 'Flour', quantity: '1', unit: 'kg', checked: false },
      { id: four[3], title: 'Basil', quantity: null, unit: null, checked: false },
    ]);
    expect((await web(workspace, source.listId)).items.map((item: { title: string }) => item.title)).toEqual(['Coffee']);
    const lists = await overview(workspace);
    expect(lists).toHaveLength(2);
    expect(lists).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source.listId, open: 1, checked: 0 }),
      expect.objectContaining({ id: vario.listId, open: 3, checked: 1 }),
    ]));
    const history = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'LIST_ITEMS_MOVED'").all() as { metadata: string }[];
    expect(history).toHaveLength(1);
    expect(JSON.parse(history[0]?.metadata ?? '{}')).toMatchObject({ count: 4, sourceListId: source.listId, destinationListId: vario.listId, mcpClientId: expect.any(String) });
    expect(history[0]?.metadata).not.toContain('Milk');
  });

  it('deletes exactly the three completed items after approval', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const list = await shopping(workspace, 'Shopping', [
      { title: 'Milk', checked: true },
      { title: 'Bread' },
      { title: 'Eggs', checked: true },
      { title: 'Milk' },
      { title: 'Apples', checked: true },
    ]);
    const mcp = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);
    const read = await mcp.body('get_grocery_list', { workspaceId: workspace, listId: list.listId });
    const completed = read.items.filter((item: { checked: boolean }) => item.checked).map((item: { id: string }) => item.id);
    expect(completed).toHaveLength(3);

    const request = { workspaceId: workspace, listId: list.listId, itemIds: completed, operationId: randomUUID(), expectedRevision: read.revision };
    const deleted = await mcp.body('delete_grocery_items', request);
    expect(deleted).toEqual({ outcome: 'DELETED', duplicate: false, deletedItemIds: completed, list: { id: list.listId, revision: read.revision + 1 } });
    // Someone re-adds Eggs; the retry still deletes nothing more.
    expect((await t.post(`/api/workspaces/${workspace}/lists/${list.listId}/items`, { title: 'Eggs' }, t.admin)).statusCode).toBe(201);
    expect(await mcp.body('delete_grocery_items', request)).toEqual({ ...deleted, duplicate: true });

    const remaining = (await web(workspace, list.listId)).items as { title: string; checked: unknown }[];
    expect(remaining.map((item) => [item.title, item.checked !== null])).toEqual([['Bread', false], ['Milk', false], ['Eggs', false]]);
    expect(await overview(workspace)).toEqual([expect.objectContaining({ id: list.listId, open: 3, checked: 0 })]);
    // Recoverable, like a removal in the app.
    expect((await t.post(`/api/workspaces/${workspace}/lists/${list.listId}/items/${completed[0]}/restore`, {}, t.admin)).statusCode).toBe(200);
    expect((await web(workspace, list.listId)).items).toHaveLength(4);
  });

  it('answers refusals with structured codes and changes nothing', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const second = await t.createWorkspace('Cabin');
    const unselected = await t.createWorkspace('Private');
    const source = await shopping(workspace, 'Shopping', [{ title: 'Milk' }, { title: 'Bread' }]);
    const vario = await shopping(workspace, 'Vario', []);
    const cabin = await shopping(second, 'Shopping', [{ title: 'Wood' }]);
    const hidden = await shopping(unselected, 'Shopping', []);
    const todo = await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Chores', kind: 'TODO' }, t.admin);
    const todoId = todo.json().list.id as string;
    const mcp = await connect(t.admin, [workspace, second], ['workspaces.read', 'lists.read', 'lists.write']);
    const revisions = async () => Object.fromEntries((await overview(workspace)).map((list) => [list.id, list.revision]));
    const start = await revisions();
    const move = (overrides: object = {}) => ({ workspaceId: workspace, sourceListId: source.listId, destinationListId: vario.listId, itemIds: [source.ids[0]], operationId: randomUUID(), expectedSourceRevision: start[source.listId], expectedDestinationRevision: start[vario.listId], ...overrides });
    const remove = (overrides: object = {}) => ({ workspaceId: workspace, listId: source.listId, itemIds: [source.ids[0]], operationId: randomUUID(), expectedRevision: start[source.listId], ...overrides });

    expect(await mcp.errorCode('move_grocery_items', move({ destinationListId: source.listId }))).toMatchObject({ code: 'same_list' });
    expect(await mcp.errorCode('move_grocery_items', move({ expectedDestinationRevision: (start[vario.listId] ?? 0) + 1 }))).toMatchObject({ code: 'stale_revision' });
    expect(await mcp.errorCode('delete_grocery_items', remove({ expectedRevision: (start[source.listId] ?? 2) - 1 }))).toMatchObject({ code: 'stale_revision' });
    const unknown = randomUUID();
    expect(await mcp.errorCode('move_grocery_items', move({ itemIds: [source.ids[0], unknown, cabin.ids[0]] }))).toEqual({ code: 'invalid_items', message: expect.any(String), itemIds: [unknown, cabin.ids[0]] });
    expect(await mcp.errorCode('delete_grocery_items', remove({ itemIds: [source.ids[1], unknown] }))).toMatchObject({ code: 'invalid_items', itemIds: [unknown] });
    expect(await mcp.errorCode('move_grocery_items', move({ itemIds: [source.ids[0], source.ids[0]] }))).toMatchObject({ code: 'duplicate_item_ids' });
    expect(await mcp.errorCode('delete_grocery_items', remove({ itemIds: [] }))).toMatchObject({ code: 'invalid_items' });
    expect(await mcp.errorCode('delete_grocery_items', remove({ itemIds: ['milk'] }))).toMatchObject({ code: 'invalid_items' });
    // Other Workspaces, selected or not, and To-do Lists are not reachable.
    expect(await mcp.errorCode('move_grocery_items', move({ destinationListId: cabin.listId, expectedDestinationRevision: 1 }))).toMatchObject({ code: 'list_not_found' });
    expect(await mcp.errorCode('move_grocery_items', move({ workspaceId: second, destinationListId: cabin.listId, expectedDestinationRevision: 1 }))).toMatchObject({ code: 'list_not_found' });
    expect(await mcp.errorCode('move_grocery_items', move({ destinationListId: todoId, expectedDestinationRevision: 1 }))).toMatchObject({ code: 'list_not_found' });
    expect(await mcp.errorCode('delete_grocery_items', remove({ workspaceId: unselected, listId: hidden.listId, expectedRevision: 1 }))).toMatchObject({ code: 'permission_denied' });

    // An operation id belongs to one request.
    const once = move();
    await mcp.body('move_grocery_items', once);
    const now = await revisions();
    expect(await mcp.errorCode('delete_grocery_items', remove({ operationId: once.operationId, itemIds: [source.ids[1]], expectedRevision: now[source.listId] }))).toMatchObject({ code: 'operation_reused' });
    expect(await mcp.errorCode('move_grocery_items', { ...once, itemIds: [source.ids[1]] })).toMatchObject({ code: 'operation_reused' });

    expect((await web(workspace, source.listId)).items.map((item: { id: string }) => item.id)).toEqual([source.ids[1]]);
    expect((await web(workspace, vario.listId)).items.map((item: { id: string }) => item.id)).toEqual([source.ids[0]]);
    expect((await web(second, cabin.listId)).items).toHaveLength(1);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM list_item_operations').get()).toEqual({ n: 1 });
  });

  it('refuses a guest, a write-less grant and a Workspace with Lists switched off', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspace = await t.createWorkspace('Casa Nostra');
    const cookie = await t.invite('helper@example.org', 'Helper');
    await t.addMember(workspace, 'helper@example.org', 'GUEST');
    const list = await shopping(workspace, 'Shopping', [{ title: 'Milk' }]);
    const vario = await shopping(workspace, 'Vario', []);
    const first = (await overview(workspace)).find((entry) => entry.id === list.listId);
    const args = { workspaceId: workspace, listId: list.listId, itemIds: list.ids, operationId: randomUUID(), expectedRevision: first?.revision };

    const guest = await connect(cookie, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);
    expect(await guest.errorCode('delete_grocery_items', args)).toMatchObject({ code: 'permission_denied' });
    expect(await guest.errorCode('move_grocery_items', { workspaceId: workspace, sourceListId: list.listId, destinationListId: vario.listId, itemIds: list.ids, operationId: randomUUID(), expectedSourceRevision: first?.revision, expectedDestinationRevision: 1 })).toMatchObject({ code: 'permission_denied' });

    const reader = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read']);
    expect((await reader.call('delete_grocery_items', args)).content[0]?.text).toBe('Tool unavailable for this connection.');

    const writer = await connect(t.admin, [workspace], ['workspaces.read', 'lists.read', 'lists.write']);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'LISTS', enabled: false }, t.admin);
    expect(await writer.errorCode('delete_grocery_items', args)).toMatchObject({ code: 'permission_denied' });
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'LISTS', enabled: true }, t.admin);
    expect((await web(workspace, list.listId)).items).toHaveLength(1);
    // With access back, the same request goes through.
    expect(await writer.body('delete_grocery_items', args)).toMatchObject({ outcome: 'DELETED', deletedItemIds: list.ids });
  });
});
