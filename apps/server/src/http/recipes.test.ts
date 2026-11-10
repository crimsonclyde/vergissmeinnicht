import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { purgeAttachmentFiles } from '@vergissmeinnicht/database';
import { ORIGIN, startTestApp } from './test-harness.ts';
const content = { version: 1, title: 'Pancakes', servings: 2, ingredients: [{ name: 'Flour', amount: '125', unit: 'g', note: '' }, { name: 'Eggs', amount: '1', unit: '', note: '' }], instructions: '# Cooking\n\nMix and cook.', tags: ['Breakfast'], source: '', prepMinutes: 5, cookMinutes: 10 };
describe('Recipes, shared originals and serving-scaled grocery transfers', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>; let workspace: string; let other: string; let user: string; let guest: string;
  const base = () => `/api/workspaces/${workspace}/recipes`;
  const save = (cookie = user, recipe: Omit<typeof content, 'servings'> & { servings: number | null; private?: boolean } = content, id?: string, revision = 0, archived = false) => t.post(base() + (id ? '/' + id : ''), { content: recipe, expectedRevision: revision, archived }, cookie);
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
  it('shares Recipes and current photos across enabled Workspaces, with home-only editing and immediate privacy changes', async () => {
    await enable();
    const reader = await t.invite('van@example.org', 'Van cook');
    await t.addMember(other, 'van@example.org', 'USER');
    const otherBase = `/api/workspaces/${other}/recipes`;
    for (const tool of ['RECIPES', 'LISTS']) await t.post(`/api/workspaces/${other}/tools`, { tool, enabled: true }, t.admin);

    const png = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#d1ad66' } }).png().withMetadata().toBuffer();
    const uploaded = await t.app.inject({ method: 'POST', url: base() + '/attachments', headers: { origin: ORIGIN, cookie: user, 'content-type': 'application/octet-stream', 'x-file-name': 'original.png' }, payload: png });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const file = uploaded.json().attachment;
    const withPhoto = { ...content, instructions: `![Pancakes](attachments/${file.id}.png)` };
    const shared = (await save(user, withPhoto)).json().recipe;
    const local = (await save(user, { ...content, title: 'Private pancakes', private: true })).json().recipe;
    // Model a Recipe saved before the visibility field existed.
    const legacy = (await save(user, { ...content, title: 'Legacy pancakes' })).json().recipe;
    t.database.sqlite.prepare("UPDATE recipes SET content=json_remove(content, '$.private') WHERE id=?").run(legacy.id);
    expect((await t.get(`${base()}/${legacy.id}`, guest)).json().recipe.private).toBe(true);
    expect((await t.get(`${otherBase}/${legacy.id}`, reader)).statusCode).toBe(404);
    const url = `${otherBase}/${shared.id}`;
    const image = `${url}/attachments/${file.id}`;
    expect((await t.get(base() + '/' + shared.id, reader)).statusCode).toBe(404);
    expect((await t.get(otherBase + '?q=pancakes', reader)).json().recipes).toEqual([
      expect.objectContaining({ id: shared.id, private: false, inCurrentWorkspace: false, homeWorkspaceName: 'Kitchen', updatedBy: '' }),
    ]);
    const visible = (await t.get(url, reader)).json().recipe;
    expect(visible.homeWorkspaceName).toBe('Kitchen');
    expect(visible).not.toHaveProperty('workspaceId');
    expect((await t.post(`/api/workspaces/${workspace}/rename`, { name: 'Main kitchen' }, t.admin)).statusCode).toBe(204);
    expect((await t.get(url, reader)).json().recipe.homeWorkspaceName).toBe('Main kitchen');
    expect((await t.get(`${otherBase}/${local.id}`, reader)).statusCode).toBe(404);
    expect((await t.get(`${otherBase}/${local.id}/export`, reader)).statusCode).toBe(404);
    expect((await t.get(otherBase + `/attachments/${file.id}/original`, reader)).statusCode).toBe(404);
    for (const kind of ['preview', 'thumbnail']) expect((await t.get(`${image}/${kind}`, reader)).statusCode).toBe(200);
    expect((await t.get(image + '/original', reader)).rawPayload.equals(png)).toBe(true);
    expect((await t.get(url + '/export', reader)).statusCode).toBe(200);
    expect((await t.post(url, { content: withPhoto, expectedRevision: 1, archived: true }, reader)).statusCode).toBe(404);

    const list = (await t.post(`/api/workspaces/${other}/lists`, { title: 'Van groceries' }, reader)).json().list;
    const input = { operationId: randomUUID(), recipeRevision: 1, listId: list.id, listRevision: list.revision, servings: 4 };
    expect((await t.get(url + '/ingredients?servings=4', reader)).json().ingredients[0].quantity).toBe('250');
    expect((await t.post(url + '/shopping', input, reader)).statusCode).toBe(200);
    await t.post(`/api/workspaces/${other}/tools`, { tool: 'RECIPES', enabled: false }, t.admin);
    expect((await t.get(url, reader)).statusCode).toBe(404);
    expect((await t.get(image + '/original', reader)).statusCode).toBe(404);
    await t.post(`/api/workspaces/${other}/tools`, { tool: 'RECIPES', enabled: true }, t.admin);

    expect((await save(user, { ...withPhoto, private: true }, shared.id, 1)).statusCode).toBe(200);
    for (const endpoint of [url, url + '/ingredients?servings=4', url + '/export', image + '/original']) {
      expect((await t.get(endpoint, reader)).statusCode).toBe(404);
    }
    expect((await t.post(url + '/shopping', input, reader)).statusCode).toBe(404);
    expect((await t.get(`${base()}/${shared.id}/attachments/${file.id}/original`, guest)).rawPayload.equals(png)).toBe(true);

    expect((await save(user, { ...content, private: false }, shared.id, 2)).statusCode).toBe(200);
    expect((await t.get(url, reader)).statusCode).toBe(200);
    expect((await t.get(image + '/original', reader)).statusCode).toBe(404);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'RECIPES', enabled: false }, t.admin);
    expect((await t.get(url, reader)).statusCode).toBe(404);
    expect((await t.get(otherBase, reader)).json().recipes).toEqual([]);
  });
  it('computes servings exactly and adds a batch once, without changing the recipe or merging items', async () => {
    await enable(); const recipe = (await save()).json().recipe;
    const list = (await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Shopping' }, user)).json().list;
    const projection = await t.get(base() + '/' + recipe.id + '/ingredients?servings=4', guest);
    expect(projection.json().ingredients.map((item: { quantity: string }) => item.quantity)).toEqual(['250', '2']);
    const input = { operationId: randomUUID(), recipeRevision: 1, listId: list.id, listRevision: list.revision, servings: 6 };
    expect((await t.post(base() + '/' + recipe.id + '/shopping', input, guest)).statusCode).toBe(403);
    expect((await t.post(base() + '/' + recipe.id + '/shopping', { ...input, servings: null }, user)).statusCode).toBe(400);
    const todo = (await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Weekend prep', kind: 'TODO' }, user)).json().list;
    const refused = await t.post(base() + '/' + recipe.id + '/shopping', { ...input, listId: todo.id, listRevision: todo.revision }, user);
    expect(refused.statusCode).toBe(404);
    expect((await t.get(`/api/workspaces/${workspace}/lists/${todo.id}`, user)).json().list.items).toEqual([]);
    const first = await t.post(base() + '/' + recipe.id + '/shopping', input, user); expect(first.statusCode, first.body).toBe(200);
    const retry = await t.post(base() + '/' + recipe.id + '/shopping', input, user); expect(retry.json()).toEqual({ ...first.json(), duplicate: true });
    expect((await t.post(base() + '/' + recipe.id + '/shopping', { ...input, servings: 3 }, user)).statusCode).toBe(409);
    const result = (await t.get(`/api/workspaces/${workspace}/lists/${list.id}`, user)).json().list;
    expect(result.items).toMatchObject([{ title: 'Flour', quantity: '375', unit: 'g' }, { title: 'Eggs', quantity: '3' }]);
    expect((await t.get(base() + '/' + recipe.id, user)).json().recipe.servings).toBe(2);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'LISTS', enabled: false }, t.admin);
    expect((await t.post(base() + '/' + recipe.id + '/shopping', input, user)).statusCode).toBe(404);
  });
  it('adds unscaled amounts for a recipe without servings and retains exact fractions', async () => {
    await enable();
    const ingredients = [...content.ingredients, { name: 'Oil', amount: '1/3', unit: 'cup', note: '' }];
    const recipe = (await save(user, { ...content, servings: null, ingredients })).json().recipe;
    expect(recipe.servings).toBeNull();
    const list = (await t.post(`/api/workspaces/${workspace}/lists`, { title: 'Shopping' }, user)).json().list;
    const url = `${base()}/${recipe.id}`;
    const projection = await t.get(url + '/ingredients?servings=6', guest);
    expect(projection.json()).toMatchObject({ baseServings: null, ingredients: [{ quantity: '125' }, { quantity: '1' }, { exactAmount: '1/3' }] });
    const input = { operationId: randomUUID(), recipeRevision: 1, listId: list.id, listRevision: list.revision, servings: null };
    const added = await t.post(url + '/shopping', input, user);
    expect(added.statusCode, added.body).toBe(200);
    const result = (await t.get(`/api/workspaces/${workspace}/lists/${list.id}`, user)).json().list;
    expect(result.items).toMatchObject([
      { title: 'Flour', quantity: '125', unit: 'g' },
      { title: 'Eggs', quantity: '1', unit: null },
      { title: '1/3 cup Oil', quantity: null, unit: null },
    ]);
    const fractional = (await save(user, { ...content, servings: 3, ingredients })).json().recipe;
    const scaled = await t.post(`${base()}/${fractional.id}/shopping`, { ...input, operationId: randomUUID(), listRevision: result.revision, servings: 1 }, user);
    expect(scaled.statusCode, scaled.body).toBe(200);
    const after = (await t.get(`/api/workspaces/${workspace}/lists/${list.id}`, user)).json().list;
    expect(after.items.slice(3)).toMatchObject([
      { title: '125/3 g Flour', quantity: null, unit: null },
      { title: '1/3 Eggs', quantity: null },
      { title: '1/9 cup Oil', quantity: null },
    ]);
    const longName = (await save(user, { ...content, servings: null, ingredients: [
      ...content.ingredients.slice(0, 1),
      { name: 'x'.repeat(120), amount: '1/3', unit: 'cup', note: '' },
    ] })).json().recipe;
    const tooLong = await t.post(`${base()}/${longName.id}/shopping`, { ...input, operationId: randomUUID(), listRevision: after.revision }, user);
    expect(tooLong.json()).toMatchObject({ error: 'recipe_shopping_measurement_too_long' });
    expect((await t.get(`/api/workspaces/${workspace}/lists/${list.id}`, user)).json().list.items).toHaveLength(6);
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
