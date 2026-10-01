import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

describe('List HTTP API (grocery lists)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let user: string;
  let editor: string;
  let guest: string;
  let outsider: string;

  const lists = (workspaceId = home) => `/api/workspaces/${workspaceId}/lists`;
  const create = async (title = 'Groceries', cookie = user) => (await t.post(lists(), { title }, cookie)).json().list as { id: string };
  const addItem = async (listId: string, body: object, cookie = user) => t.post(`${lists()}/${listId}/items`, body, cookie);

  beforeEach(async () => {
    t = await startTestApp();
    user = await t.invite('user@example.org', 'Uma');
    editor = await t.invite('editor@example.org', 'Eddie');
    guest = await t.invite('guest@example.org', 'Gus');
    outsider = await t.invite('outsider@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
  });

  afterEach(async () => t.close());

  it('runs the grocery flow: create, add, edit, check, remove and undo', async () => {
    const created = await t.post(lists(), { title: ' Groceries ' }, user);
    expect(created.statusCode).toBe(201);
    const list = created.json().list;
    expect(list).toMatchObject({ kind: 'GROCERY', title: 'Groceries', revision: 1, createdBy: 'Uma', deleted: false, items: [] });

    const milk = await addItem(list.id, { title: 'Milk', quantity: '2', unit: 'l' });
    expect(milk.statusCode).toBe(201);
    const milkId = milk.json().itemId as string;
    const bread = (await addItem(list.id, { title: 'Bread' }, editor)).json();
    expect(bread.list.items).toMatchObject([
      { id: milkId, title: 'Milk', quantity: '2', unit: 'l', addedBy: 'Uma', checked: null, revision: 1 },
      { id: bread.itemId, title: 'Bread', quantity: null, unit: null, addedBy: 'Eddie', checked: null },
    ]);

    const item = `${lists()}/${list.id}/items/${milkId}`;
    const edited = await t.post(`${item}/update`, { title: 'Oat milk', quantity: '1,5', unit: 'l', expectedRevision: 1 }, user);
    expect(edited.json().list.items[0]).toMatchObject({ title: 'Oat milk', quantity: '1.5', revision: 2 });
    expect((await t.post(`${item}/update`, { title: 'Soy milk', expectedRevision: 1 }, editor)).json()).toEqual({ error: 'list_conflict' });

    const checked = (await t.post(`${item}/check`, { checked: true }, editor)).json().list;
    expect(checked.items[0].checked).toMatchObject({ by: 'Eddie' });
    // Ticked again by the other shopper: fine, and still Eddie's.
    expect((await t.post(`${item}/check`, { checked: true }, user)).json().list.items[0].checked).toMatchObject({ by: 'Eddie' });
    expect((await t.get(lists(), guest)).json().lists).toMatchObject([{ id: list.id, title: 'Groceries', open: 1, checked: 1 }]);
    // Undo of the purchase.
    expect((await t.post(`${item}/check`, { checked: false }, user)).json().list.items[0].checked).toBeNull();

    expect((await t.post(`${item}/remove`, {}, user)).json().list.items).toHaveLength(1);
    expect((await t.post(`${item}/remove`, {}, user)).json()).toEqual({ error: 'list_item_not_found' });
    expect((await t.post(`${item}/restore`, {}, user)).json().list.items.map((i: { title: string }) => i.title)).toEqual(['Oat milk', 'Bread']);

    expect((await t.post(`${lists()}/${list.id}/rename`, { title: 'Weekly shop', expectedTitle: 'Groceries' }, user)).json().list.title).toBe('Weekly shop');
    expect((await t.post(`${lists()}/${list.id}/rename`, { title: 'Market', expectedTitle: 'Groceries' }, editor)).json()).toEqual({ error: 'list_conflict' });
    expect((await t.post(`${lists()}/${list.id}/delete`, {}, user)).json().list.deleted).toBe(true);
    expect((await t.get(`${lists()}/${list.id}`, user)).json()).toEqual({ error: 'list_not_found' });
    expect((await t.get(lists(), user)).json().lists).toEqual([]);
    expect((await t.post(`${lists()}/${list.id}/restore`, {}, user)).json().list).toMatchObject({ title: 'Weekly shop', deleted: false });

    // Answers carry display names only.
    const body = (await t.get(`${lists()}/${list.id}`, guest)).body;
    expect(body).not.toMatch(/userId|@example|workspaceId/);
  });

  it('enforces session, Origin, list.edit and Workspace scope', async () => {
    const list = await create();
    const itemId = (await addItem(list.id, { title: 'Milk' })).json().itemId as string;
    const base = `${lists()}/${list.id}`;
    const writes: [string, object][] = [
      [lists(), { title: 'Mine' }],
      [`${base}/rename`, { title: 'Mine', expectedTitle: 'Groceries' }],
      [`${base}/delete`, {}],
      [`${base}/restore`, {}],
      [`${base}/items`, { title: 'Beer' }],
      [`${base}/items/${itemId}/update`, { title: 'Beer', expectedRevision: 1 }],
      [`${base}/items/${itemId}/check`, { checked: true }],
      [`${base}/items/${itemId}/remove`, {}],
      [`${base}/items/${itemId}/restore`, {}],
    ];
    for (const [url, body] of writes) {
      expect({ url, status: (await t.post(url, body)).statusCode }).toEqual({ url, status: 401 });
      // Only an MFA challenge cookie: no session.
      expect({ url, status: (await t.post(url, body, '__Secure-vmn.mfa_challenge=x')).statusCode }).toEqual({ url, status: 401 });
      // Cookie-authenticated POST without Origin: refused before anything else.
      expect({ url, status: (await t.post(url, body, user, null)).statusCode }).toEqual({ url, status: 403 });
      // GUEST reads but never writes.
      const asGuest = await t.post(url, body, guest);
      expect({ url, status: asGuest.statusCode, body: asGuest.json() }).toEqual({ url, status: 403, body: { error: 'forbidden' } });
      // No member of Home.
      expect({ url, body: (await t.post(url, body, outsider)).json() }).toEqual({ url, body: { error: 'workspace_not_found' } });
    }
    expect((await t.get(lists())).statusCode).toBe(401);
    expect((await t.get(base, guest)).statusCode).toBe(200);
    expect((await t.get(lists(), outsider)).json()).toEqual({ error: 'workspace_not_found' });
    expect((await t.get(base, outsider)).json()).toEqual({ error: 'workspace_not_found' });

    // Otto administers Office: Home's ids under Office's id are unknown.
    const viaOffice = `${lists(office)}/${list.id}`;
    expect((await t.get(viaOffice, outsider)).json()).toEqual({ error: 'list_not_found' });
    expect((await t.post(`${viaOffice}/items`, { title: 'Beer' }, outsider)).json()).toEqual({ error: 'list_not_found' });
    expect((await t.post(`${viaOffice}/items/${itemId}/check`, { checked: true }, outsider)).json()).toEqual({ error: 'list_not_found' });
    expect((await t.post(`${viaOffice}/delete`, {}, outsider)).json()).toEqual({ error: 'list_not_found' });

    const after = (await t.get(base, user)).json().list;
    expect(after).toMatchObject({ title: 'Groceries', deleted: false, items: [{ title: 'Milk', checked: null, revision: 1 }] });
  });

  it('validates bodies strictly', async () => {
    const list = await create();
    const itemId = (await addItem(list.id, { title: 'Milk' })).json().itemId as string;
    const base = `${lists()}/${list.id}`;
    const cases: [string, object, string][] = [
      [lists(), {}, 'invalid_request'],
      [lists(), { title: '   ' }, 'list_title_empty'],
      [lists(), { title: 'x'.repeat(81) }, 'list_title_too_long'],
      [lists(), { title: 'Ours', kind: 'TODO' }, 'invalid_request'],
      [lists(), { title: 'Ours', id: list.id }, 'invalid_request'],
      [lists(), { title: 'Ours', workspaceId: office }, 'invalid_request'],
      [`${base}/rename`, { title: 'Ours' }, 'invalid_request'],
      [`${base}/items`, { title: '' }, 'list_item_title_empty'],
      [`${base}/items`, { title: 'x'.repeat(121) }, 'list_item_title_too_long'],
      [`${base}/items`, { title: 'Milk', quantity: 'lots' }, 'invalid_list_item_quantity'],
      [`${base}/items`, { title: 'Milk', quantity: 2 }, 'invalid_request'],
      [`${base}/items`, { title: 'Milk', unit: 'x'.repeat(17) }, 'list_item_unit_too_long'],
      [`${base}/items`, { title: 'Milk', checked: true }, 'invalid_request'],
      [`${base}/items`, { title: 'Milk', listId: list.id }, 'invalid_request'],
      [`${base}/items/${itemId}/update`, { title: 'Milk' }, 'invalid_request'],
      [`${base}/items/${itemId}/update`, { title: 'Milk', expectedRevision: 0 }, 'invalid_request'],
      [`${base}/items/${itemId}/check`, { checked: 'yes' }, 'invalid_request'],
      [`${base}/items/${itemId}/check`, {}, 'invalid_request'],
    ];
    for (const [url, body, error] of cases) {
      const response = await t.post(url, body, user);
      expect([url, response.statusCode, response.json().error]).toEqual([url, 400, error]);
    }
    // A body beyond the route's limit never reaches the use-case.
    expect((await t.post(`${base}/items`, { title: 'x'.repeat(5000) }, user)).statusCode).toBe(413);
    const after = (await t.get(base, user)).json().list;
    expect(after.items).toMatchObject([{ title: 'Milk', revision: 1 }]);
    expect((await t.get(lists(), user)).json().lists).toHaveLength(1);
  });
});
