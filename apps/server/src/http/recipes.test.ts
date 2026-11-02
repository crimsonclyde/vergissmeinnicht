import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { purgeAttachmentFiles } from '@vergissmeinnicht/database';
import { ORIGIN, startTestApp } from './test-harness.ts';
const content = { version: 1, title: 'Pancakes', servings: 2, ingredients: [{ name: 'Flour', amount: '125', unit: 'g', note: '' }, { name: 'Eggs', amount: '1', unit: '', note: '' }], instructions: '# Cooking\n\nMix and cook.', tags: ['Breakfast'], source: '', prepMinutes: 5, cookMinutes: 10 };
describe('Recipes, shared originals and serving-scaled grocery transfers', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>; let workspace: string; let other: string; let user: string; let guest: string;
  const base = () => `/api/workspaces/${workspace}/recipes`;
  const save = (cookie = user, recipe = content, id?: string, revision = 0, archived = false) => t.post(base() + (id ? '/' + id : ''), { content: recipe, expectedRevision: revision, archived }, cookie);
  beforeEach(async () => {
    t = await startTestApp(); workspace = await t.createWorkspace('Kitchen'); other = await t.createWorkspace('Van');
    user = await t.invite('cook@example.org', 'Cook'); guest = await t.invite('guest@example.org', 'Guest');
    await t.addMember(workspace, 'cook@example.org', 'USER'); await t.addMember(workspace, 'guest@example.org', 'GUEST');
  });
  afterEach(() => t.close());
  const enable = async () => { for (const tool of ['RECIPES', 'LISTS']) expect((await t.post(`/api/workspaces/${workspace}/tools`, { tool, enabled: true }, t.admin)).statusCode).toBe(200); };
  it('preserves the tool, guest, foreign id, stale edit and archive boundaries', async () => {
    for (const cookie of [user, guest, t.admin]) expect((await t.get(base(), cookie)).statusCode).toBe(404);
    await enable(); expect((await save(guest)).statusCode).toBe(403);
    const created = await save(); expect(created.statusCode, created.body).toBe(201); const recipe = created.json().recipe;
    expect((await t.get(base(), guest)).json().recipes[0].title).toBe('Pancakes');
    expect((await t.get(`/api/workspaces/${other}/recipes/${recipe.id}`, user)).statusCode).toBe(404);
    expect((await save(user, content, recipe.id, 0)).statusCode).toBe(409);
    expect((await save(user, content, recipe.id, 1, true)).statusCode).toBe(200);
    expect((await t.get(base(), guest)).json().recipes).toEqual([]);
    expect((await t.get(base() + '?archived=true', guest)).json().recipes).toHaveLength(1);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'RECIPES', enabled: false }, t.admin);
    expect((await t.get(base() + '/' + recipe.id, t.admin)).statusCode).toBe(404);
  });
  it('computes servings exactly and adds a batch once, without changing the recipe or merging items', async () => {
    await enable(); const recipe = (await save()).json().recipe;
    const list = (await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Shopping' }, user)).json().list;
    const projection = await t.get(base() + '/' + recipe.id + '/ingredients?servings=4', guest);
    expect(projection.json().ingredients.map((item: { quantity: string }) => item.quantity)).toEqual(['250', '2']);
    const input = { operationId: randomUUID(), recipeRevision: 1, listId: list.id, listRevision: list.revision, servings: 4, items: [{ ingredient: 0, title: 'Flour', quantity: '250', unit: 'g' }, { ingredient: 1, title: 'Eggs', quantity: '2', unit: null }] };
    expect((await t.post(base() + '/' + recipe.id + '/shopping', input, guest)).statusCode).toBe(403);
    const first = await t.post(base() + '/' + recipe.id + '/shopping', input, user); expect(first.statusCode, first.body).toBe(200);
    const retry = await t.post(base() + '/' + recipe.id + '/shopping', input, user); expect(retry.json()).toEqual({ ...first.json(), duplicate: true });
    expect((await t.post(base() + '/' + recipe.id + '/shopping', { ...input, servings: 3 }, user)).statusCode).toBe(409);
    const result = (await t.get(`/api/workspaces/${workspace}/lists/${list.id}`, user)).json().list;
    expect(result.items).toHaveLength(2); expect(result.items[0]).toMatchObject({ title: 'Flour', quantity: '250', unit: 'g' });
    expect((await t.get(base() + '/' + recipe.id, user)).json().recipe.servings).toBe(2);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'LISTS', enabled: false }, t.admin);
    expect((await t.post(base() + '/' + recipe.id + '/shopping', input, user)).statusCode).toBe(404);
  });
  it('rolls back the entire batch when auditing fails and refuses stale destination revisions', async () => {
    await enable(); const recipe = (await save()).json().recipe; const list = (await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Shopping' }, user)).json().list;
    const input = { operationId: randomUUID(), recipeRevision: 1, listId: list.id, listRevision: list.revision, servings: 4, items: [{ ingredient: 0, title: 'Flour', quantity: '250', unit: 'g' }] };
    expect((await t.post(base() + '/' + recipe.id + '/shopping', { ...input, listRevision: 999 }, user)).statusCode).toBe(409);
    t.database.sqlite.exec("CREATE TRIGGER fail_recipe_transfer BEFORE INSERT ON security_events WHEN NEW.type='RECIPE_SHOPPING_TRANSFERRED' BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    expect((await t.post(base() + '/' + recipe.id + '/shopping', input, user)).statusCode).toBe(500);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM list_items WHERE list_id=?').get(list.id)).toEqual({ n: 0 });
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipe_shopping_operations').get()).toEqual({ n: 0 });
  });
  it('uses an independent attachment policy and retains exact originals after recipe edits', async () => {
    await enable(); const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#d1ad66' } }).png().withMetadata().toBuffer();
    const uploaded = await t.app.inject({ method: 'POST', url: base() + '/attachments', headers: { origin: ORIGIN, cookie: user, 'content-type': 'application/octet-stream', 'x-file-name': 'pancakes.png' }, payload: png });
    expect(uploaded.statusCode, uploaded.body).toBe(201); const file = uploaded.json().attachment;
    expect((await t.get(base() + `/attachments/${file.id}/original`, guest)).statusCode).toBe(404);
    const created = await save(user, { ...content, instructions: `![Pancakes](attachments/${file.id}.png)` }); expect(created.statusCode, created.body).toBe(201);
    expect((await t.get(base() + `/attachments/${file.id}/original`, guest)).rawPayload.equals(png)).toBe(true);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'JOURNAL', enabled: true }, t.admin);
    expect((await t.get(`/api/workspaces/${workspace}/journal/attachments/${file.id}/original`, user)).statusCode).toBe(404);
    expect((await save(user, content, created.json().recipe.id, 1)).statusCode).toBe(200);
    await purgeAttachmentFiles(t.database, t.services.recipeAttachments.store, new Date(Date.now() + 2 * 86400000));
    expect((await t.get(base() + `/attachments/${file.id}/original`, guest)).rawPayload.equals(png)).toBe(true);
  });
});
