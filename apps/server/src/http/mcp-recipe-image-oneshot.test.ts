import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import type { McpScope, UserId } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
afterEach(async () => { await app?.close(); });

it('creates and updates a pictured Recipe in one ChatGPT call, including a WebP image', async () => {
  const webp = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#aa5522' } }).webp({ lossless: true }).toBuffer();
  const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#114422' } }).jpeg().toBuffer();
  let downloads = 0;
  const t = app = await startTestApp({ mcpEnabled: true, captureLogs: true, chatGptFileSource: async function* (url) {
    downloads++;
    yield url.pathname.endsWith('.webp') ? webp : jpeg;
  } });
  const workspaceId = await t.createWorkspace('Cookbook');
  expect((await t.post(`/api/workspaces/${workspaceId}/tools`, { tool: 'RECIPES', enabled: true }, t.admin)).statusCode).toBe(200);
  const actorId = (await t.get('/api/auth/session', t.admin)).json().user.id as UserId;
  const actor = await t.services.users.findById(actorId);
  if (!actor) throw new Error('Missing actor');
  const scopes: McpScope[] = ['recipes.read', 'recipes.write', 'lists.covers.write'];
  const clientId = randomUUID();
  const redirectUri = 'https://client.example.org/callback';
  const resource = ORIGIN + '/mcp';
  await t.services.mcp.registerClient(clientId, { client_name: 'One-call photo test' });
  const request = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource });
  const code = new URL(await t.services.mcp.approve(actor, request, [workspaceId], scopes, true)).searchParams.get('code');
  if (!code) throw new Error('Missing authorization code');
  const token = (await t.services.mcp.exchange(clientId, code, 'code', redirectUri, resource)).access_token;
  const rpc = (method: string, params: object) => t.app.inject({
    method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
  const call = async (name: string, args: object) => {
    const response = await rpc('tools/call', { name, arguments: args });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().result;
  };

  // ChatGPT sees only the native file routes; base64 and picker tools remain for other clients.
  const tools = (await rpc('tools/list', {})).json().result.tools as { name: string; _meta?: Record<string, unknown> }[];
  const meta = (name: string) => tools.find(tool => tool.name === name)?._meta;
  expect(meta('create_recipe')).toEqual({ 'openai/fileParams': ['image'] });
  expect(meta('set_recipe_image')).toEqual({ 'openai/fileParams': ['image'] });
  expect(meta('upload_list_cover_file')).toEqual({ 'openai/fileParams': ['file'] });
  for (const name of ['upload_recipe_image', 'upload_recipe_image_file', 'open_recipe_image_upload', 'upload_list_cover', 'open_list_cover_upload']) {
    expect(meta(name)).toMatchObject({ 'openai/visibility': 'private' });
  }
  expect(meta('open_recipe_image_upload')).toMatchObject({ ui: { resourceUri: expect.stringContaining('ui://') } });

  const content = {
    version: 1, title: 'Tomato soup', servings: 2,
    ingredients: [{ name: 'Tomatoes', amount: '4', unit: '', note: '' }],
    instructions: 'Simmer the tomatoes.', tags: ['Soup'], source: '', prepMinutes: 5, cookMinutes: 20,
  };
  const required = await call('create_recipe', { workspaceId, operationId: randomUUID(), requireImage: true, content });
  expect(required.content[0].text).toContain('recipe_cover_required');

  // ChatGPT may add descriptive keys to the file object; they are ignored.
  const image = { file_id: 'file-generated', file_name: 'soup.webp', mime_type: 'image/webp', size: webp.byteLength,
    download_url: 'https://sdmntswcentralus.oaiusercontent.com/container/soup.webp?sig=fixture-secret' };
  const createArgs = { workspaceId, operationId: randomUUID(), requireImage: true, content, image };
  const created = await call('create_recipe', createArgs);
  expect(created.isError, JSON.stringify(created)).toBeUndefined();
  const recipeId = JSON.parse(created.content[0].text).recipeId as string;
  const saved = JSON.parse((await call('get_recipe', { workspaceId, recipeId })).content[0].text);
  expect(saved.coverImage).toMatch(/^attachments\/[0-9a-f-]{36}\.png$/);
  expect(saved.instructions).toBe(`![Recipe photo](${saved.coverImage})\n\nSimmer the tomatoes.`);
  const attachmentId = saved.coverImage.slice('attachments/'.length, -'.png'.length);
  const stored = (await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${attachmentId}/original`, t.admin)).rawPayload;
  expect((await sharp(stored).metadata()).format).toBe('png');
  expect(await sharp(stored).raw().toBuffer()).toEqual(await sharp(webp).raw().toBuffer());

  // A retry with a renewed signature reuses the upload and the Recipe without another download.
  const retry = await call('create_recipe', { ...createArgs, image: { ...image, download_url: image.download_url.replace('fixture-secret', 'renewed') } });
  expect(JSON.parse(retry.content[0].text)).toEqual({ recipeId, duplicate: true });
  expect(downloads).toBe(1);

  // Replace the cover of an existing Recipe in one call; a retry after the save is a no-op.
  const photo = { file_id: 'file-pdf-photo', file_name: 'cookbook.jpg',
    download_url: 'https://files.oaiusercontent.com/file-pdf-photo?sig=fixture-secret' };
  const setArgs = { workspaceId, recipeId, expectedRevision: saved.revision, operationId: randomUUID(), image: photo, replaceCover: true };
  const replaced = await call('set_recipe_image', setArgs);
  expect(replaced.isError, JSON.stringify(replaced)).toBeUndefined();
  const after = JSON.parse(replaced.content[0].text);
  expect(after.coverImage).toMatch(/\.jpg$/);
  expect(after.instructions).toBe(`![Recipe photo](${after.coverImage})\n\nSimmer the tomatoes.`);
  expect(after.revision).toBe(saved.revision + 1);
  expect(JSON.parse((await call('set_recipe_image', setArgs)).content[0].text)).toMatchObject({ revision: after.revision, coverImage: after.coverImage });
  const stale = await call('set_recipe_image', { ...setArgs, operationId: randomUUID(), image: { ...photo, file_id: 'file-other' } });
  expect(stale.isError).toBe(true);

  // A storage host that is not reviewed is named for the operator, without the signed part.
  const refused = await call('create_recipe', { ...createArgs, operationId: randomUUID(),
    image: { ...image, download_url: 'https://oaisdmntprwesteurope.blob.core.windows.net/container/x.png?sig=fixture-secret' } });
  expect(refused.content[0].text).toContain('Refused host: oaisdmntprwesteurope.blob.core.windows.net');
  expect(refused.content[0].text).not.toContain('fixture-secret');
  expect(t.logs).toContain('oaisdmntprwesteurope.blob.core.windows.net');
  expect(t.logs).not.toContain('fixture-secret');
});
