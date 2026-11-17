import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

it('scopes Map imports to the live grant, holds possible matches and keeps private visits out of MCP', async () => {
  const app = await startTestApp({ mcpEnabled: true });
  try {
    const workspaceId = await app.createWorkspace('Casa Nostra');
    const otherId = await app.createWorkspace('Van');
    const rootPath = '/api/workspaces/' + workspaceId;
    const switchMap = (enabled: boolean) => app.post(rootPath + '/tools', { tool: 'MAP', enabled }, app.admin);
    await switchMap(true);
    const actor = await app.services.users.findById((await app.get('/api/auth/session', app.admin)).json().user.id);
    if (!actor) throw new Error('Missing actor');
    async function connect(scopes: McpScope[]) {
      if (!actor) throw new Error('Missing actor');
      const clientId = randomUUID();
      const redirect = 'https://client.example.org/callback';
      await app.services.mcp.registerClient(clientId, { client_name: 'Test assistant' });
      const requestId = await app.services.mcp.begin({ clientId, redirectUri: redirect, state: null, codeChallenge: 'a'.repeat(43), scopes, resource: ORIGIN + '/mcp' });
      const approved = await app.services.mcp.approve(actor, requestId, [workspaceId], scopes, true);
      const { access_token } = await app.services.mcp.exchange(clientId, String(new URL(approved).searchParams.get('code')), 'code', redirect, ORIGIN + '/mcp');
      const rpc = async (method: string, params: object = {}) => {
        const response = await app.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access_token, accept: 'application/json, text/event-stream' },
          payload: { jsonrpc: '2.0', id: 1, method, params } });
        expect(response.statusCode, response.body).toBe(200);
        return response.json().result;
      };
      return {
        async call(name: string, args: object) {
          const result = await rpc('tools/call', { name, arguments: { workspaceId, ...args } });
          return result.isError ? result.structuredContent.error : JSON.parse(result.content[0].text);
        },
        async names() { return (await rpc('tools/list')).tools.map((tool: { name: string }) => tool.name); },
      };
    }
    const reader = await connect(['map.read']);
    expect(await reader.names()).toContain('search_places');
    expect(await reader.names()).not.toContain('create_place');
    const writer = await connect(['map.read', 'map.write']);
    expect(await writer.names()).toEqual(expect.arrayContaining(['create_place', 'preview_place_import', 'import_places', 'update_place_fields']));
    const place = { name: 'Gerbontina', category: 'urbex', details: { locality: 'Creppo', address: 'Confirmed manually' } };
    expect(await reader.call('create_place', { operationId: randomUUID(), place })).toHaveProperty('code');
    expect(await writer.call('create_place', { workspaceId: otherId, operationId: randomUUID(), place })).toHaveProperty('code');
    const operationId = randomUUID();
    const saved = await writer.call('create_place', { operationId, place });
    expect(saved).toMatchObject({ duplicate: false, id: expect.any(String) });
    expect(await writer.call('create_place', { operationId, place })).toMatchObject({ id: saved.id, duplicate: true });
    expect(await writer.call('create_place', { operationId, place: { name: 'Altered' } })).toHaveProperty('code', 'operation_reused');
    await app.post(rootPath + '/map/places/' + saved.id + '/visits', { note: 'Very private note' }, app.admin);
    const view = await reader.call('get_place', { placeId: saved.id });
    expect(JSON.stringify(view)).not.toContain('Very private note');
    expect(await reader.call('preview_place_import', { place })).toMatchObject({ possible: [saved.id] });
    const batch = [
      { operationId: randomUUID(), place },
      { operationId: randomUUID(), place: { name: 'Unresolved link', details: { originalUrl: 'https://maps.app.goo.gl/link2' } } },
      { operationId: randomUUID(), place: { name: 'Invalid URL', details: { website: 'javascript:alert(1)' } } },
    ];
    expect(await writer.call('import_places', { items: batch })).toMatchObject({
      items: [{ status: 'needs_review' }, { status: 'created', unresolved: true }, { status: 'invalid_value', field: 'website' }],
    });
    const patch = { placeId: saved.id, expectedRevision: 1, operationId: randomUUID(), changes: { details: { routeAccess: 'Unknown' } } };
    expect(await writer.call('update_place_fields', patch)).toMatchObject({ id: saved.id, duplicate: false });
    expect(await writer.call('update_place_fields', patch)).toMatchObject({ id: saved.id, duplicate: true });
    expect(await reader.call('get_place', { placeId: saved.id })).toMatchObject({
      revision: 2, details: { address: 'Confirmed manually', routeAccess: 'Unknown', locality: 'Creppo' },
    });
    await switchMap(false);
    expect(await writer.call('create_place', { operationId, place })).toHaveProperty('code');
    expect(await writer.names()).not.toContain('get_place');
  } finally { await app.close(); }
});
