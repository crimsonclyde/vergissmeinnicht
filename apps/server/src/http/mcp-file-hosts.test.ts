import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope, UserId } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/**
 * ChatGPT file hosts (steps.md 36.25): a refused storage host is listed in Server admin, a server
 * admin allows it with one tap and the next upload works without a restart or release.
 */
describe('ChatGPT file hosts in Server admin', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => { await t?.close(); });

  async function setup(options: { chatGptFileHosts?: string } = {}) {
    const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#aa5522' } }).jpeg().toBuffer();
    const fetched: string[] = [];
    t = await startTestApp({ mcpEnabled: true, captureLogs: true, ...options, chatGptFileSource: async function* (url) { fetched.push(url.hostname); yield jpeg; } });
    const workspaceId = await t.createWorkspace('Cookbook');
    expect((await t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'RECIPES', enabled: true }, t.admin)).statusCode).toBe(200);
    const actor = await t.services.users.findById((await t.get('/api/auth/session', t.admin)).json().user.id as UserId);
    if (!actor) throw new Error('Missing actor');
    const scopes: McpScope[] = ['recipes.read', 'recipes.write'];
    const clientId = randomUUID(); const redirectUri = 'https://client.example.org/callback'; const resource = ORIGIN + '/mcp';
    await t.services.mcp.registerClient(clientId, { client_name: 'ChatGPT' });
    const request = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource });
    const code = new URL(await t.services.mcp.approve(actor, request, [workspaceId], scopes, true)).searchParams.get('code');
    if (!code) throw new Error('Missing code');
    const access = (await t.services.mcp.exchange(clientId, code, 'code', redirectUri, resource)).access_token;
    const upload = async (host: string, operationId = randomUUID()) => {
      const response = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access, accept: 'application/json, text/event-stream' },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_recipe_image_file', arguments: {
          workspaceId, recipeId: null, operationId,
          file: { download_url: `https://${host}/container/pdf-crop.jpg?sp=r&sig=fixture-secret`, file_id: 'file-pdf-crop', file_name: 'crop.jpg' } } } } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().result;
    };
    return { upload, fetched };
  }

  it('accepts the Azure host ChatGPT uses for images cropped out of a PDF', async () => {
    const { upload, fetched } = await setup();
    const result = await upload('oaisdmntprdenmarkeast.blob.core.windows.net');
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(result.structuredContent.attachment.format).toBe('JPEG');
    expect(fetched).toEqual(['oaisdmntprdenmarkeast.blob.core.windows.net']);
  });

  it('honours MCP_CHATGPT_FILE_HOSTS in the upload tool (it was refused before the download in 0.14.1)', async () => {
    const { upload, fetched } = await setup({ chatGptFileHosts: 'oaisdmntprwesteurope.blob.core.windows.net' });
    expect((await upload('oaisdmntprwesteurope.blob.core.windows.net')).isError).toBeUndefined();
    expect(fetched).toEqual(['oaisdmntprwesteurope.blob.core.windows.net']);
  });

  it('lists a refused host, lets a server admin allow it for the next try, and remove it again', async () => {
    const { upload, fetched } = await setup();
    const host = 'oaisdmntprswedencentral.blob.core.windows.net';
    const operationId = randomUUID();
    const refused = await upload(host, operationId);
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toMatchObject({ code: 'file_origin_unsupported', host });
    expect(refused.content[0].text).toContain('Server admin');
    expect(fetched).toEqual([]);
    await upload(host, operationId);
    expect(t.logs).not.toContain('fixture-secret');

    const member = await t.invite('member@example.org', 'Member');
    expect((await t.get('/api/admin/mcp/file-hosts', member)).statusCode).toBe(403);
    expect((await t.post('/api/admin/mcp/file-hosts/allow', { host }, member)).statusCode).toBe(403);
    const listed = await t.get('/api/admin/mcp/file-hosts', t.admin);
    expect(listed.json().hosts).toMatchObject([{ host, status: 'REFUSED', refusedCount: 2, decidedBy: null }]);
    expect(listed.body).not.toContain('fixture-secret');

    // Only a host VMN reported can be allowed; a typed-in name or another shape is refused.
    expect((await t.post('/api/admin/mcp/file-hosts/allow', { host: 'attacker.blob.core.windows.net' }, t.admin)).json()).toEqual({ error: 'file_host_unknown' });
    expect((await t.post('/api/admin/mcp/file-hosts/allow', { host: 'evil.example' }, t.admin)).statusCode).toBe(400);
    expect((await t.post('/api/admin/mcp/file-hosts/allow', { host: 'a.b.blob.core.windows.net' }, t.admin)).statusCode).toBe(400);

    expect((await t.post('/api/admin/mcp/file-hosts/allow', { host }, t.admin)).statusCode).toBe(200);
    expect((await t.get('/api/admin/mcp/file-hosts', t.admin)).json().hosts).toMatchObject([{ host, status: 'ALLOWED', decidedBy: 'Ada' }]);
    const allowed = await upload(host, operationId);
    expect(allowed.isError, JSON.stringify(allowed)).toBeUndefined();
    expect(fetched).toEqual([host]);

    expect((await t.post('/api/admin/mcp/file-hosts/remove', { host }, t.admin)).statusCode).toBe(200);
    expect((await upload(host)).isError).toBe(true);
    expect(fetched).toEqual([host]);
    const events = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'MCP_FILE_HOST_CHANGED' ORDER BY occurred_at").all() as { metadata: string }[];
    expect(events.map(event => JSON.parse(event.metadata))).toEqual([{ action: 'allow', host }, { action: 'remove', host }]);
  });

  it('never stores other hosts and keeps the review list bounded', async () => {
    const { upload } = await setup();
    await upload('files.evil.example');
    await upload('a.b.oaiusercontent.com');
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM mcp_file_hosts').get()).toEqual({ n: 0 });
    for (let i = 0; i < 25; i++) await upload(`oaistore${i}.blob.core.windows.net`);
    const rows = t.database.sqlite.prepare('SELECT host FROM mcp_file_hosts').all() as { host: string }[];
    expect(rows).toHaveLength(20);
    expect(rows.map(row => row.host)).toContain('oaistore24.blob.core.windows.net');
    expect(rows.map(row => row.host)).not.toContain('oaistore0.blob.core.windows.net');
  });
});
