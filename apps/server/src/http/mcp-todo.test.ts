import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.21: To-do Lists through their own opt-in MCP scopes. */
describe('MCP To-do Lists', () => {
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

  async function shopping(workspaceId: string, title: string, kind: 'GROCERY' | 'TODO', items: { title: string; quantity?: string; unit?: string; checked?: boolean }[]) {
    const created = await t.post(`/api/workspaces/${workspaceId}/lists`, { title, kind }, t.admin);
    expect(created.statusCode, created.body).toBe(201);
    const listId = created.json().list.id as string;
    const ids: string[] = [];
    for (const item of items) {
      const added = await t.post(`/api/workspaces/${workspaceId}/lists/${listId}/items`, { title: item.title, ...(kind === 'GROCERY' ? { quantity: item.quantity ?? null, unit: item.unit ?? null } : {}) }, t.admin);
      expect(added.statusCode, added.body).toBe(201);
      ids.push(added.json().itemId);
      if (item.checked) expect((await t.post(`/api/workspaces/${workspaceId}/lists/${listId}/items/${added.json().itemId}/check`, { checked: true }, t.admin)).statusCode).toBe(200);
    }
    return { listId, ids };
  }
  const web = async (workspaceId: string, listId: string) => (await t.get(`/api/workspaces/${workspaceId}/lists/${listId}`, t.admin)).json().list;

  it('offers To-do tools only to To-do grants, and keeps grocery and To-do grants apart', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const chores = await shopping(workspaceId, 'Chores', 'TODO', [{ title: 'Mow lawn' }]);
    const groceries = await shopping(workspaceId, 'Weekly shop', 'GROCERY', [{ title: 'Milk' }]);

    const todo = await connect(t.admin, [workspaceId], ['workspaces.read', 'todos.read', 'todos.write']);
    const names = ((await todo.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_todo_lists', 'get_todo_list', 'create_todo_list', 'add_todo_item', 'update_todo_items', 'move_todo_items', 'delete_todo_items', 'list_deleted_todo_items', 'restore_todo_items']));
    expect(names).not.toContain('get_grocery_list');
    expect((await todo.body('list_todo_lists', { workspaceId })).lists.map((list: { title: string }) => list.title)).toEqual(['Chores']);
    expect(await todo.errorCode('get_todo_list', { workspaceId, listId: groceries.listId })).toMatchObject({ code: 'not_found' });
    expect(await todo.errorCode('update_todo_items', { workspaceId, listId: groceries.listId, expectedRevision: 1, operationId: randomUUID(), items: [{ itemId: groceries.ids[0], done: true }] })).toMatchObject({ code: 'list_not_found' });

    const grocery = await connect(t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write']);
    const groceryNames = ((await grocery.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(groceryNames).not.toContain('get_todo_list');
    expect((await grocery.body('list_grocery_lists', { workspaceId })).lists.map((list: { title: string }) => list.title)).toEqual(['Weekly shop']);
    expect(await grocery.errorCode('update_grocery_items', { workspaceId, listId: chores.listId, expectedRevision: 1, operationId: randomUUID(), items: [{ itemId: chores.ids[0], checked: true }] })).toMatchObject({ code: 'list_not_found' });
    expect((await grocery.call('create_grocery_list', { workspaceId, listId: randomUUID(), operationId: randomUUID(), title: 'Groceries 2' })).isError).not.toBe(true);
    expect((await web(workspaceId, chores.listId)).items[0].checked).toBeNull();

    const readOnly = await connect(t.admin, [workspaceId], ['workspaces.read', 'todos.read']);
    const readable = ((await readOnly.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(readable).toContain('get_todo_list');
    expect(readable).not.toContain('update_todo_items');
  });

  it('creates a To-do List, adds, renames, ticks, moves, deletes and restores tasks', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const todo = await connect(t.admin, [workspaceId], ['workspaces.read', 'todos.read', 'todos.write']);
    const listId = randomUUID();
    await todo.body('create_todo_list', { workspaceId, listId, operationId: randomUUID(), title: 'Weekend' });
    const created = await t.get(`/api/workspaces/${workspaceId}/lists/${listId}`, t.admin);
    expect(created.json().list).toMatchObject({ title: 'Weekend', kind: 'TODO' });
    const mow = randomUUID();
    const bins = randomUUID();
    await todo.body('add_todo_item', { workspaceId, listId, operationId: randomUUID(), itemId: mow, title: 'Mow lawn' });
    await todo.body('add_todo_item', { workspaceId, listId, operationId: randomUUID(), itemId: bins, title: 'Bins out' });

    let read = await todo.body('get_todo_list', { workspaceId, listId });
    expect(read.tasks).toEqual([{ id: mow, title: 'Mow lawn', done: false }, { id: bins, title: 'Bins out', done: false }]);
    await todo.body('update_todo_items', { workspaceId, listId, expectedRevision: read.revision, operationId: randomUUID(), items: [{ itemId: mow, done: true }, { itemId: bins, title: 'Take the bins out' }] });
    read = await todo.body('get_todo_list', { workspaceId, listId });
    expect(read.tasks).toEqual([{ id: mow, title: 'Mow lawn', done: true }, { id: bins, title: 'Take the bins out', done: false }]);

    const laterId = randomUUID();
    await todo.body('create_todo_list', { workspaceId, listId: laterId, operationId: randomUUID(), title: 'Later' });
    const later = await todo.body('get_todo_list', { workspaceId, listId: laterId });
    const moved = await todo.body('move_todo_items', { workspaceId, sourceListId: listId, destinationListId: laterId, itemIds: [bins], operationId: randomUUID(), expectedSourceRevision: read.revision, expectedDestinationRevision: later.revision });
    expect(moved.movedItemIds).toEqual([bins]);

    const deleted = await todo.body('delete_todo_items', { workspaceId, listId, itemIds: [mow], operationId: randomUUID(), expectedRevision: moved.sourceList.revision });
    const gone = await todo.body('list_deleted_todo_items', { workspaceId, listId });
    expect(gone.deletedTasks.map((task: { id: string; done: boolean }) => [task.id, task.done])).toEqual([[mow, true]]);
    await todo.body('restore_todo_items', { workspaceId, listId, itemIds: [mow], operationId: randomUUID(), expectedRevision: deleted.list.revision });
    expect((await todo.body('get_todo_list', { workspaceId, listId })).tasks).toEqual([{ id: mow, title: 'Mow lawn', done: true }]);
  });
});
