import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import type { McpScope, UserId } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
afterEach(async () => { await app?.close(); });

it('uploads supplied original bytes through OAuth MCP and safely attaches them on recipe save', async () => {
  const t = app = await startTestApp({ mcpEnabled: true });
  const workspaceId = await t.createWorkspace('Cookbook');
  const foreignWorkspace = await t.createWorkspace('Other cookbook');
  for (const id of [workspaceId, foreignWorkspace]) {
    expect((await t.post(`/api/workspaces/${id}/tools`, { tool: 'RECIPES', enabled: true }, t.admin)).statusCode).toBe(200);
  }
  const content = {
    version: 1, title: 'Tomato pasta', servings: 2,
    ingredients: [{ name: 'Pasta', amount: '', unit: '', note: '' }],
    instructions: 'Cook the pasta.', tags: ['Dinner'], source: '', prepMinutes: 5, cookMinutes: 10,
  };
  const create = async (id: string) => {
    const response = await t.post(`/api/workspaces/${id}/recipes`, { content, expectedRevision: 0, archived: false }, t.admin);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().recipe.id as string;
  };
  const recipeId = await create(workspaceId);
  const foreignRecipe = await create(foreignWorkspace);
  const get = () => t.get(`/api/workspaces/${workspaceId}/recipes/${recipeId}`, t.admin);
  const actorId = (await t.get('/api/auth/session', t.admin)).json().user.id as UserId;
  const actor = await t.services.users.findById(actorId);
  if (!actor) throw new Error('Missing actor');
  async function grant(scopes: McpScope[]) {
    if (!actor) throw new Error('Missing actor');
    const clientId = randomUUID();
    const redirectUri = 'https://client.example.org/callback';
    const resource = ORIGIN + '/mcp';
    await t.services.mcp.registerClient(clientId, { client_name: 'Recipe photo test' });
    const id = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource });
    const url = await t.services.mcp.approve(actor, id, [workspaceId], scopes, true);
    const code = new URL(url).searchParams.get('code');
    if (!code) throw new Error('Missing authorization code');
    return (await t.services.mcp.exchange(clientId, code, 'code', redirectUri, resource)).access_token;
  }
  const write = await grant(['recipes.read', 'recipes.write']);
  const read = await grant(['recipes.read']);
  const rpc = (method: string, params: object, access = write) => t.app.inject({
    method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
  const call = async (name: string, args: object) => {
    const response = await rpc('tools/call', { name, arguments: args });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().result;
  };
  const toolList = (await rpc('tools/list', {})).json().result.tools;
  expect(toolList).toContainEqual(expect.objectContaining({ name: 'upload_recipe_image', annotations: expect.objectContaining({ idempotentHint: true }) }));
  expect((await rpc('tools/list', {}, read)).body).not.toContain('upload_recipe_image');
  const open = await call('open_recipe_image_upload', { workspaceId, recipeId });
  expect(open.structuredContent).toEqual({ workspaceId, recipeId });
  const widget = toolList.find((tool: { name: string }) => tool.name === 'open_recipe_image_upload')._meta.ui.resourceUri;
  expect((await rpc('resources/read', { uri: widget })).json().result.contents[0].text).toContain('readAsDataURL');

  // A real PNG with metadata and enough pixel data to cross the ordinary 128 KiB MCP cap.
  const pixels = Buffer.alloc(256 * 256 * 3);
  for (let i = 0, value = 137; i < pixels.length; i++) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    pixels[i] = value >>> 24;
  }
  const original = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).withMetadata().png().toBuffer();
  const args = { workspaceId, recipeId, operationId: randomUUID(), fileName: 'pasta.png', imageBase64: original.toString('base64') };
  const upload = (input = args) => call('upload_recipe_image', input);
  expect((await rpc('tools/call', { name: 'upload_recipe_image', arguments: args }, read)).statusCode).toBe(413);
  expect((await rpc('tools/call', { name: 'upload_recipe_image', arguments: args }, 'bogus')).statusCode).toBe(401);
  expect((await upload({ ...args, recipeId: foreignRecipe })).isError).toBe(true);
  expect((await upload({ ...args, workspaceId: foreignWorkspace, recipeId: foreignRecipe })).isError).toBe(true);
  expect((await upload({ ...args, imageBase64: Buffer.from('<html>not an image</html>').toString('base64') })).isError).toBe(true);
  t.database.sqlite.prepare('UPDATE attachment_settings SET default_quota_bytes=0').run();
  expect((await upload()).isError).toBe(true);
  expect((await get()).json().recipe).toMatchObject({ revision: 1, instructions: content.instructions });
  t.database.sqlite.prepare('UPDATE attachment_settings SET default_quota_bytes=500000000').run();

  const attempts = await Promise.all([upload(), upload()]);
  expect(attempts.filter(result => result.structuredContent?.duplicate === false)).toHaveLength(1);
  const { attachment, markdown } = attempts.find(result => result.structuredContent?.duplicate === false).structuredContent;
  const replay = await upload();
  expect(replay.structuredContent).toMatchObject({ attachment, duplicate: true });
  expect((await upload({ ...args, fileName: 'changed.png' })).isError).toBe(true);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 1 });
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachment_reservations').get()).toEqual({ n: 0 });

  const saved = await call('save_recipe', { workspaceId, recipeId, expectedRevision: 1, content: { ...content, instructions: `Cook the pasta.\n\n${markdown}`, coverImage: attachment.reference } });
  expect(saved.isError).toBeUndefined();
  const canonical = await call('get_recipe', { workspaceId, recipeId });
  expect(JSON.parse(canonical.content[0].text)).toMatchObject({ id: recipeId, revision: 2, coverImage: attachment.reference });
  const endpoint = `/api/workspaces/${workspaceId}/recipes/attachments/${attachment.id}`;
  expect((await t.get(endpoint + '/original', t.admin)).rawPayload.equals(original)).toBe(true);
  expect((await t.get(endpoint + '/thumbnail', t.admin)).headers['content-type']).toBe('image/jpeg');

  const newUpload = await call('upload_recipe_image', { ...args, recipeId: null, operationId: randomUUID() });
  expect(newUpload.structuredContent.attachment.id).not.toBe(attachment.id);
  const created = await call('create_recipe', { workspaceId, operationId: randomUUID(), content: { ...content, title: 'Second pasta', instructions: newUpload.structuredContent.markdown, coverImage: newUpload.structuredContent.attachment.reference } });
  expect(created.isError).toBeUndefined();

  t.database.sqlite.prepare("UPDATE memberships SET role='GUEST' WHERE workspace_id=? AND user_id=?").run(workspaceId, actorId);
  expect((await upload()).isError).toBe(true);
});
