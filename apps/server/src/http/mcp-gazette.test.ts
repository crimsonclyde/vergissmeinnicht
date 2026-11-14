import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultGazetteSettings, sampleGazetteEdition, type McpScope, type TimeZoneName } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 43.4: the The Daily Planet through its own opt-in MCP scopes. */
describe('MCP The Daily Planet', () => {
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

  async function enable(workspaceId: string, tools: string[]) {
    for (const tool of tools) {
      const settings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
      if (settings.tools.includes(tool)) continue;
      const response = await t.post(`/api/workspaces/${workspaceId}/tools`, { tool, enabled: true, expectedRevision: settings.revision }, t.admin);
      expect(response.statusCode, response.body).toBe(200);
    }
  }
  const today = () => new Date().toISOString().slice(0, 10);

  it('offers the Gazette tools only to grants that include them, and publishes idempotently', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Triora');
    await enable(workspaceId, ['GAZETTE']);
    expect((await t.post(`/api/workspaces/${workspaceId}/gazette/settings`, { settings: defaultGazetteSettings('UTC' as TimeZoneName), expectedRevision: 0 }, t.admin)).statusCode).toBe(200);
    const other = await connect(t.admin, [workspaceId], ['workspaces.read', 'notes.read']);
    const otherNames = ((await other.rpc('tools/list')).tools as { name: string }[]).map(tool => tool.name);
    for (const name of ['get_gazette_config', 'publish_gazette_edition', 'update_watchlist_prices']) expect(otherNames).not.toContain(name);
    const reader = await connect(t.admin, [workspaceId], ['workspaces.read', 'gazette.read']);
    const readNames = ((await reader.rpc('tools/list')).tools as { name: string }[]).map(tool => tool.name);
    expect(readNames).toEqual(expect.arrayContaining(['get_gazette_config', 'list_gazette_editions', 'get_gazette_edition', 'list_watchlist_items']));
    expect(readNames).not.toContain('publish_gazette_edition');

    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'gazette.read', 'gazette.write']);
    const config = await assistant.body('get_gazette_config', { workspaceId });
    expect(config).toMatchObject({ today: today(), timeZone: 'UTC' });
    expect(config.sections.map((section: { id: string }) => section.id)).toEqual(['weather', 'it-open-source', 'liguria', 'europe-world', 'good-news', 'watchlist']);
    const operationId = randomUUID();
    const content = sampleGazetteEdition(today());
    const first = await assistant.body('publish_gazette_edition', { workspaceId, operationId, content });
    expect(first).toMatchObject({ duplicate: false, edition: { date: today(), state: 'PUBLISHED', revision: 1, sections: 6 } });
    expect(await assistant.body('publish_gazette_edition', { workspaceId, operationId, content })).toMatchObject({ duplicate: true, edition: { id: first.edition.id } });
    // A malformed edition names the field and leaves the published one in place.
    const refused = await assistant.errorCode('publish_gazette_edition', { workspaceId, operationId: randomUUID(), content: { ...content, intro: '<b>hi</b>' } });
    expect(refused).toMatchObject({ code: 'invalid_value', fields: ['edition.intro'] });
    expect((await assistant.body('get_gazette_edition', { workspaceId, date: today() })).edition.revision).toBe(1);

    // Watchlist: read items, record a checked price; an unknown item stores nothing.
    const item = (await t.post(`/api/workspaces/${workspaceId}/gazette/watchlist`, { item: { name: 'Kettle', currency: 'EUR', target: 40 } }, t.admin)).json().item;
    expect((await assistant.body('list_watchlist_items', { workspaceId })).items).toMatchObject([{ id: item.id, name: 'Kettle', latest: null }]);
    expect(await assistant.errorCode('update_watchlist_prices', { workspaceId, observations: [{ itemId: randomUUID(), price: 1, checkedAt: new Date().toISOString() }] })).toMatchObject({ code: 'not_found' });
    expect(await assistant.body('update_watchlist_prices', { workspaceId, observations: [{ itemId: item.id, price: 38.5, checkedAt: new Date().toISOString(), verified: true, source: 'Example Shop' }] })).toEqual({ recorded: 1 });
    expect((await assistant.body('list_watchlist_items', { workspaceId })).items[0].latest).toMatchObject({ price: 38.5, verified: true });
    // A read-only grant cannot publish, even when asked to.
    expect((await reader.call('publish_gazette_edition', { workspaceId, operationId: randomUUID(), content })).isError).toBe(true);
  });
});
