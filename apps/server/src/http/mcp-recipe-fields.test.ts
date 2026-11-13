import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.23: partial Recipe edits and archiving through MCP. */
describe('MCP Recipe fields and archive', () => {
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
    const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[]; structuredContent?: { error: { code: string; message: string; fields?: string[] } } }>;
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

  async function setup() {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const settings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
    expect((await t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'RECIPES', enabled: true, expectedRevision: settings.revision }, t.admin)).statusCode).toBe(200);
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'recipes.read', 'recipes.write']);
    const content = { version: 1, title: 'Pumpkin soup', servings: 4, ingredients: [{ name: 'Pumpkin', amount: '1', unit: 'kg', note: '' }, { name: 'Salt', amount: 'a pinch', unit: '', note: '' }], instructions: 'Cook the pumpkin.', tags: ['autumn'], categories: ['soup', 'starter'], source: '', prepMinutes: 15, cookMinutes: 30, private: true };
    const recipeId = (await assistant.body('create_recipe', { workspaceId, operationId: randomUUID(), content })).recipeId as string;
    return { workspaceId, assistant, recipeId };
  }

  it('changes only the named fields, appends to the instructions, and keeps the rest', async () => {
    const { workspaceId, assistant, recipeId } = await setup();
    const read = await assistant.body('get_recipe', { workspaceId, recipeId });
    const changed = await assistant.body('update_recipe_fields', { workspaceId, recipeId, expectedRevision: read.revision, changes: { servings: 6, appendInstructions: 'Serve with toasted seeds.' } });
    expect(changed).toMatchObject({
      revision: read.revision + 1,
      title: 'Pumpkin soup',
      servings: 6,
      instructions: 'Cook the pumpkin.\n\nServe with toasted seeds.',
      ingredients: read.ingredients,
      tags: ['autumn'],
      categories: read.categories,
      prepMinutes: 15,
      cookMinutes: 30,
      private: true,
    });
    const retitled = await assistant.body('update_recipe_fields', { workspaceId, recipeId, expectedRevision: changed.revision, changes: { title: 'Roast pumpkin soup', tags: ['autumn', 'vegan'] } });
    expect(retitled).toMatchObject({ title: 'Roast pumpkin soup', tags: ['autumn', 'vegan'], servings: 6, private: true });
    expect(await assistant.errorCode('update_recipe_fields', { workspaceId, recipeId, expectedRevision: changed.revision, changes: { title: 'Old' } })).toMatchObject({ code: 'stale_revision' });
    expect(await assistant.errorCode('update_recipe_fields', { workspaceId, recipeId, expectedRevision: retitled.revision, changes: {} })).toMatchObject({ code: 'empty_edit' });
    expect(await assistant.errorCode('update_recipe_fields', { workspaceId, recipeId, expectedRevision: retitled.revision, changes: { instructions: 'x', appendInstructions: 'y' } })).toMatchObject({ code: 'invalid_arguments' });
    expect((await assistant.body('get_recipe', { workspaceId, recipeId })).title).toBe('Roast pumpkin soup');
  });

  it('archives and restores a Recipe without losing anything', async () => {
    const { workspaceId, assistant, recipeId } = await setup();
    const read = await assistant.body('get_recipe', { workspaceId, recipeId });
    const archived = await assistant.body('archive_recipe', { workspaceId, recipeId, expectedRevision: read.revision, archived: true });
    expect(archived).toMatchObject({ archived: true, title: 'Pumpkin soup', ingredients: read.ingredients });
    expect((await assistant.body('search_recipes', { workspaceId, query: 'pumpkin' })).recipes).toEqual([]);
    expect((await assistant.body('search_recipes', { workspaceId, query: 'pumpkin', archived: true })).recipes.map((recipe: { id: string }) => recipe.id)).toEqual([recipeId]);
    // Asking again for the state it already has changes nothing.
    expect((await assistant.body('archive_recipe', { workspaceId, recipeId, expectedRevision: archived.revision, archived: true })).revision).toBe(archived.revision);
    const restored = await assistant.body('archive_recipe', { workspaceId, recipeId, expectedRevision: archived.revision, archived: false });
    expect(restored).toMatchObject({ archived: false, instructions: read.instructions, private: true });
    expect((await assistant.body('search_recipes', { workspaceId, query: 'pumpkin' })).recipes.map((recipe: { id: string }) => recipe.id)).toEqual([recipeId]);
    expect(await assistant.errorCode('archive_recipe', { workspaceId, recipeId, expectedRevision: archived.revision, archived: true })).toMatchObject({ code: 'stale_revision' });
  });
});
