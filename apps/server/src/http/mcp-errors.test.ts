import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.20: every MCP tool answers a failure with a structured error code. */
describe('MCP structured errors', () => {
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
    const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[]; structuredContent?: { error: { code: string; message: string; fields?: string[]; itemIds?: string[] } } }>;
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

  it('gives every refusal a code, fields where useful, and the guidance in the instructions', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const { listId } = await shopping(workspaceId, 'Weekly shop', [{ title: 'Milk' }]);
    const toolSettings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
    expect((await t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'RECIPES', enabled: true, expectedRevision: toolSettings.revision }, t.admin)).statusCode).toBe(200);
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write', 'recipes.read', 'recipes.write', 'procedures.read']);
    const initialized = await assistant.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(initialized.instructions).toContain('structuredContent.error.code');

    expect(await assistant.errorCode('get_grocery_list', { workspaceId, listId: randomUUID() })).toMatchObject({ code: 'not_found' });
    expect(await assistant.errorCode('get_grocery_list', { workspaceId, listId: 'not-a-uuid' })).toMatchObject({ code: 'invalid_arguments', fields: ['listId'] });
    expect(await assistant.errorCode('add_grocery_item', { workspaceId, listId, operationId: randomUUID(), itemId: randomUUID(), title: 'Eggs', quantity: 'lots', unit: null })).toMatchObject({ code: 'invalid_value', fields: ['quantity'] });
    expect(await assistant.errorCode('get_recipe', { workspaceId, recipeId: randomUUID() })).toMatchObject({ code: 'not_found' });
    expect(await assistant.errorCode('get_procedure', { workspaceId, procedureId: randomUUID() })).toMatchObject({ code: 'not_found' });
    const unavailable = await assistant.call('complete_run_step', { workspaceId });
    expect(unavailable.structuredContent?.error.code).toBe('tool_unavailable');
    // A Workspace that was not selected for this connection.
    const other = await t.createWorkspace('Office');
    expect(await assistant.errorCode('list_grocery_lists', { workspaceId: other })).toMatchObject({ code: 'permission_denied' });

    // A stale recipe revision.
    const content = { version: 1, title: 'Soup', servings: 2, ingredients: [{ name: 'Water', amount: '1', unit: 'l', note: '' }], instructions: 'Boil.', tags: [], categories: ['soup'], source: '', prepMinutes: null, cookMinutes: null };
    const created = await assistant.body('create_recipe', { workspaceId, operationId: randomUUID(), content });
    const recipeId = created.recipeId as string;
    const read = await assistant.body('get_recipe', { workspaceId, recipeId });
    await assistant.body('save_recipe', { workspaceId, recipeId, expectedRevision: read.revision, content: { ...content, title: 'Soup 2' } });
    const stale = await assistant.errorCode('save_recipe', { workspaceId, recipeId, expectedRevision: read.revision, content: { ...content, title: 'Soup 3' } });
    expect(stale).toMatchObject({ code: 'stale_revision' });
    expect(stale?.message).toContain('Nothing was changed');
    expect((await assistant.body('get_recipe', { workspaceId, recipeId })).title).toBe('Soup 2');

    // Lists switched off in the Workspace.
    const tools = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
    expect((await t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'LISTS', enabled: false, expectedRevision: tools.revision }, t.admin)).statusCode).toBe(200);
    expect(await assistant.errorCode('list_grocery_lists', { workspaceId })).toMatchObject({ code: 'tool_disabled' });
  });
});
