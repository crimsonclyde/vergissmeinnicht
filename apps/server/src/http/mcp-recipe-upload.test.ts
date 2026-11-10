import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import type { McpScope, UserId } from '@vergissmeinnicht/domain';
import { ChatGptFileError } from '../integrations/chatgpt-files.ts';
import { ORIGIN, startTestApp } from './test-harness.ts';

let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
afterEach(async () => { await app?.close(); });

it('uploads supplied original bytes through OAuth MCP and safely attaches them on recipe save', async () => {
  const attachedJpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#114422' } }).withMetadata().jpeg().toBuffer();
  let downloads = 0;
  const t = app = await startTestApp({ mcpEnabled: true, captureLogs: true, chatGptFileSource: async function* (url) {
    downloads++;
    if (url.pathname.endsWith('interrupted')) {
      yield attachedJpeg.subarray(0, 8);
      throw new ChatGptFileError('file_download_failed');
    }
    yield attachedJpeg;
  } });
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
  expect((await t.get(`/api/workspaces/${workspaceId}/recipes/${foreignRecipe}`, t.admin)).statusCode).toBe(200);
  expect((await call('get_recipe', { workspaceId, recipeId: foreignRecipe })).isError).toBe(true);
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
  const delegatedRecipe = JSON.parse(created.content[0].text).recipeId as string;
  expect((await t.get(`/api/workspaces/${workspaceId}/recipes/${delegatedRecipe}`, t.admin)).json().recipe.private).toBe(true);
  expect((await t.get(`/api/workspaces/${foreignWorkspace}/recipes/${delegatedRecipe}`, t.admin)).statusCode).toBe(404);

  // Cover access is a separate grant, including when the List is a To-do List.
  const list = (await t.post(`/api/workspaces/${workspaceId}/lists`, { title: 'Pack for the trip', kind: 'TODO' }, t.admin)).json().list;
  const file = { download_url: 'https://files.oaiusercontent.com/file-pdf-photo?sig=fixture-secret', file_id: 'file-pdf-photo', file_name: 'photo.jpg' };
  const fileUpload = { workspaceId, recipeId: null, operationId: randomUUID(), file };
  const recipeFileTool = toolList.find((tool: { name: string }) => tool.name === 'upload_recipe_image_file');
  expect(recipeFileTool._meta['openai/fileParams']).toEqual(['file']);
  expect(recipeFileTool.inputSchema.properties.file.required.sort()).toEqual(['download_url', 'file_id']);
  expect(Object.keys(recipeFileTool.inputSchema.properties.file.properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type']);
  expect((await rpc('tools/call', { name: 'upload_recipe_image_file', arguments: fileUpload }, read)).json().result.isError).toBe(true);
  expect((await call('upload_recipe_image_file', { ...fileUpload, recipeId: foreignRecipe })).isError).toBe(true);
  expect((await call('upload_recipe_image_file', { ...fileUpload, file: { ...file, download_url: 'https://127.0.0.1/file-pdf-photo' } })).content[0].text).toContain('file_source_invalid');
  expect(downloads).toBe(0);
  const staged = (await call('upload_recipe_image_file', fileUpload)).structuredContent;
  expect(staged.attachment.format).toBe('JPEG');
  const refreshed = { file_id: file.file_id, download_url: 'https://files.oaiusercontent.com/file-pdf-photo?sig=refreshed' };
  expect((await call('upload_recipe_image_file', { ...fileUpload, file: refreshed })).structuredContent).toMatchObject({ duplicate: true, attachment: staged.attachment });
  expect((await call('upload_recipe_image_file', { ...fileUpload, file: { ...file, file_id: 'file-different' } })).isError).toBe(true);
  expect(downloads).toBe(1);
  const createArgs = { workspaceId, operationId: randomUUID(), requireImage: true, content: { ...content, title: 'Recipe from attached photo' } };
  const noCover = await call('create_recipe', createArgs);
  expect(noCover.isError).toBe(true);
  expect(noCover.content[0].text).toContain('recipe_cover_required');
  const invalidCover = `attachments/${randomUUID()}.jpg`;
  expect((await call('create_recipe', { ...createArgs, content: { ...createArgs.content, instructions: `![Photo](${invalidCover})`, coverImage: invalidCover } })).isError).toBe(true);
  expect((await call('search_recipes', { workspaceId, query: createArgs.content.title })).content[0].text).toContain('"recipes":[]');
  const pictured = await call('create_recipe', { ...createArgs, content: { ...createArgs.content, instructions: staged.markdown, coverImage: staged.attachment.reference } });
  expect(pictured.isError).toBeUndefined();
  const picturedId = JSON.parse(pictured.content[0].text).recipeId;
  expect(JSON.parse((await call('get_recipe', { workspaceId, recipeId: picturedId })).content[0].text)).toMatchObject({ coverImage: staged.attachment.reference });
  expect((await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${staged.attachment.id}/original`, t.admin)).rawPayload).toEqual(attachedJpeg);
  expect(t.logs).not.toContain('fixture-secret');

  const coverGrant = await grant(['lists.covers.write']);
  const coverRpc = async (name: string, args: object) =>
    (await rpc('tools/call', { name, arguments: args }, coverGrant)).json().result;
  const coverTools = (await rpc('tools/list', {}, coverGrant)).json().result.tools;
  expect(coverTools.map((tool: { name: string }) => tool.name)).not.toContain('get_grocery_list');
  expect(coverTools.find((tool: { name: string }) => tool.name === 'upload_list_cover_file')._meta['openai/fileParams']).toEqual(['file']);
  const coverWidget = coverTools.find((tool: { name: string }) => tool.name === 'open_list_cover_upload')._meta.ui.resourceUri;
  expect((await rpc('resources/read', { uri: coverWidget }, coverGrant)).json().result.contents[0].text).toContain('upload_list_cover');
  expect((await call('list_cover_targets', { workspaceId })).isError).toBe(true);
  const targets = JSON.parse((await coverRpc('list_cover_targets', { workspaceId })).content[0].text).lists;
  expect(targets).toContainEqual({ id: list.id, title: list.title, kind: 'TODO', revision: 1, coverId: null });
  expect((await coverRpc('open_list_cover_upload', { workspaceId, listId: list.id })).structuredContent).toEqual({ workspaceId, listId: list.id });
  const input = { workspaceId, listId: list.id, operationId: randomUUID(), fileName: 'cover.png', imageBase64: original.toString('base64') };
  expect((await rpc('tools/call', { name: 'upload_list_cover', arguments: input }, write)).statusCode).toBe(413);
  const cover = (await coverRpc('upload_list_cover', input)).structuredContent.attachment.id as string;
  expect((await coverRpc('upload_list_cover', input)).structuredContent).toMatchObject({ duplicate: true, attachment: { id: cover } });
  const update = { workspaceId, listId: list.id, expectedRevision: 1, coverId: cover };
  expect((await coverRpc('set_list_cover', update)).isError).toBeUndefined();
  const coverPath = `/api/workspaces/${workspaceId}/lists/${list.id}/cover`;
  expect((await t.get(coverPath + `/${cover}/original`, t.admin)).rawPayload.equals(original)).toBe(true);
  const replacement = (await coverRpc('upload_list_cover', { ...input, operationId: randomUUID() })).structuredContent.attachment.id as string;
  expect((await coverRpc('set_list_cover', { ...update, coverId: replacement })).isError).toBe(true);
  expect((await coverRpc('set_list_cover', { ...update, coverId: replacement, expectedRevision: 2 })).isError).toBeUndefined();
  expect((await t.get(coverPath + `/${cover}/original`, t.admin)).statusCode).toBe(404);
  expect((await coverRpc('set_list_cover', { ...update, coverId: null, expectedRevision: 3 })).isError).toBeUndefined();
  expect((await t.get(coverPath + `/${replacement}/original`, t.admin)).statusCode).toBe(404);

  const fileCover = (await coverRpc('upload_list_cover_file', { workspaceId, listId: list.id, operationId: randomUUID(), file })).structuredContent.attachment.id;
  expect((await coverRpc('set_list_cover', { ...update, coverId: fileCover, expectedRevision: 4 })).isError).toBeUndefined();
  expect((await t.get(coverPath + `/${fileCover}/original`, t.admin)).rawPayload).toEqual(attachedJpeg);
  expect(downloads).toBe(2);
  const counted = () => t.database.sqlite.prepare('SELECT count(*) AS n FROM attachments').get();
  const before = counted();
  const interrupted = await call('upload_recipe_image_file', { ...fileUpload, operationId: randomUUID(),
    file: { download_url: 'https://files.oaiusercontent.com/file-interrupted?sig=fixture-secret', file_id: 'file-interrupted' } });
  expect(interrupted.content[0].text).toContain('file_download_failed');
  expect(counted()).toEqual(before);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachment_reservations').get()).toEqual({ n: 0 });
  expect(t.logs).not.toContain('fixture-secret');

  t.database.sqlite.prepare("UPDATE memberships SET role='GUEST' WHERE workspace_id=? AND user_id=?").run(workspaceId, actorId);
  expect((await upload()).isError).toBe(true);
});
