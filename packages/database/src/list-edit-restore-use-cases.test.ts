import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ListBatchError,
  ListNotFoundError,
  NotAuthorizedError,
  addListItem,
  addMember,
  changeMemberRole,
  createList,
  createWorkspace,
  getList,
  listRemovedListItems,
  removeListItems,
  restoreListItems,
  setListItemChecked,
  updateListItem,
  updateListItems,
  type ListDeps,
  type ListItemEditRequest,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { MAX_ITEMS_PER_LIST, normalizeEmail, type ListId, type ListItemId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createListRepository } from './list-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository, createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

/** 36.19: editing and ticking several items at once, and putting removed items back. */
describe('Lists: batch edit and restore', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let workspaceDeps: WorkspaceDeps;
  let deps: ListDeps;
  let admin: User;
  let member: User;
  let guest: User;
  let outsider: User;
  let home: Workspace;
  let office: Workspace;

  const count = (table: string, where = '1') => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
  const newList = async (title: string, kind: 'GROCERY' | 'TODO' = 'GROCERY', workspace = home, actor = member) =>
    (await createList(deps, { actor, workspaceId: workspace.id, title, kind })).list;
  const add = async (listId: ListId, title: string, quantity?: string, unit?: string, workspace = home) =>
    (await addListItem(deps, { actor: member, workspaceId: workspace.id, listId, title, quantity, unit })).itemId;
  const read = (listId: ListId, workspace = home) => getList(deps, { actor: member, workspaceId: workspace.id, listId });
  const revision = async (listId: ListId, workspace = home) => (await read(listId, workspace)).list.revision;
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ListBatchError) return { code: error.code, itemIds: [...error.itemIds] };
      throw error;
    }
    throw new Error('Expected a refusal');
  };
  const edit = async (listId: ListId, edits: ListItemEditRequest[], extra: { actor?: User; workspace?: Workspace; operationId?: string } = {}) =>
    updateListItems(deps, {
      actor: extra.actor ?? member,
      workspaceId: (extra.workspace ?? home).id,
      listId,
      edits,
      operationId: extra.operationId ?? randomUUID(),
      expectedRevision: await revision(listId, extra.workspace ?? home),
    });
  const remove = async (listId: ListId, itemIds: string[]) =>
    removeListItems(deps, { actor: member, workspaceId: home.id, listId, itemIds, operationId: randomUUID(), expectedRevision: await revision(listId) });
  const restore = async (listId: ListId, itemIds: string[], extra: { actor?: User; workspace?: Workspace } = {}) =>
    restoreListItems(deps, { actor: extra.actor ?? member, workspaceId: (extra.workspace ?? home).id, listId, itemIds, operationId: randomUUID(), expectedRevision: await revision(listId) });

  /** Shopping with Milk (2 l), Eggs (10, checked) and Bread. */
  async function shopping() {
    const list = await newList('Shopping');
    const milk = await add(list.id, 'Milk', '2', 'l');
    const eggs = await add(list.id, 'Eggs', '10');
    const bread = await add(list.id, 'Bread');
    await setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId: eggs, checked: true });
    return { list, milk, eggs, bread };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-11-12T10:00:00.000Z');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, lists: createListRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    outsider = await user('outsider@example.org', 'Otto');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Casa Nostra' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: guest.email, role: 'GUEST' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: outsider.email, role: 'ADMIN' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: member.email, role: 'USER' });
  });

  afterEach(() => database.dispose());

  it('renames, changes quantity and unit, and ticks items in one step, raising the List revision once', async () => {
    const { list, milk, eggs, bread } = await shopping();
    const before = await revision(list.id);
    now = new Date('2026-11-12T11:00:00.000Z');
    const result = await edit(list.id, [
      { itemId: milk, title: 'Oat milk', quantity: '1,50' },
      { itemId: bread, checked: true },
      { itemId: eggs, checked: false, unit: 'pack' },
    ]);
    expect(result).toEqual({ duplicate: false, itemIds: [milk, eggs, bread], revisions: { [list.id]: before + 1 } });
    const items = (await read(list.id)).items;
    expect(items.map((item) => [item.title, item.quantity, item.unit, item.checked?.by.displayName ?? null])).toEqual([
      ['Oat milk', '1.5', 'l', null],
      ['Eggs', '10', 'pack', null],
      ['Bread', null, null, 'Uma'],
    ]);
    // Content edits raise the item revision (the app's own edit checks it); a tick alone does not.
    expect(items.map((item) => item.revision)).toEqual([2, 2, 1]);
    const web = items[0];
    if (web === undefined) throw new Error('missing');
    await updateListItem(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId: milk as ListItemId, title: 'Milk', quantity: '1', unit: 'l', expectedRevision: web.revision });
    expect(count('security_events', "type = 'LIST_ITEMS_UPDATED'")).toBe(1);
    expect(database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'LIST_ITEMS_UPDATED'").get()).toEqual({ metadata: JSON.stringify({ listId: list.id, count: 3, checked: 1 }) });
  });

  it('clears quantity and unit with null, keeps fields left out, and treats an already ticked item as done', async () => {
    const { list, milk, eggs } = await shopping();
    const checkedAt = (await read(list.id)).items.find((item) => item.id === eggs)?.checked?.at;
    now = new Date('2026-11-12T12:00:00.000Z');
    await edit(list.id, [{ itemId: milk, quantity: null, unit: null }, { itemId: eggs, checked: true }]);
    const items = (await read(list.id)).items;
    expect(items[0]).toMatchObject({ title: 'Milk', quantity: null, unit: null });
    // Eggs were already ticked: the first tick stays recorded.
    expect(items[1]?.checked?.at).toEqual(checkedAt);
  });

  it('refuses the whole edit for unknown, removed, foreign and repeated items, empty edits and invalid values', async () => {
    const { list, milk, bread } = await shopping();
    const other = await newList('Other');
    const foreign = await add(other.id, 'Foreign');
    await remove(list.id, [bread]);
    expect(await refusal(edit(list.id, [{ itemId: milk, title: 'Changed' }, { itemId: bread, checked: true }]))).toEqual({ code: 'invalid_items', itemIds: [bread] });
    expect(await refusal(edit(list.id, [{ itemId: foreign, title: 'Mine' }]))).toEqual({ code: 'invalid_items', itemIds: [foreign] });
    expect(await refusal(edit(list.id, [{ itemId: milk, checked: true }, { itemId: milk, checked: false }]))).toEqual({ code: 'duplicate_item_ids', itemIds: [milk] });
    expect(await refusal(edit(list.id, [{ itemId: milk }]))).toEqual({ code: 'empty_edit', itemIds: [milk] });
    await expect(edit(list.id, [{ itemId: milk, quantity: '-1' }])).rejects.toMatchObject({ code: 'invalid_list_item_quantity' });
    await expect(edit(list.id, [{ itemId: milk, title: '   ' }])).rejects.toThrow();
    expect((await read(list.id)).items[0]).toMatchObject({ title: 'Milk', quantity: '2', unit: 'l', checked: null });
    expect(count('list_item_operations', "kind = 'UPDATE'")).toBe(0);
  });

  it('refuses a stale revision, another Workspace, guests and demoted accounts', async () => {
    const { list, milk } = await shopping();
    const stale = await revision(list.id);
    await add(list.id, 'Butter');
    expect(await refusal(updateListItems(deps, { actor: member, workspaceId: home.id, listId: list.id, edits: [{ itemId: milk, checked: true }], operationId: randomUUID(), expectedRevision: stale }))).toEqual({ code: 'stale_revision', itemIds: [] });
    // The List exists only in "home": addressed through "office" it is not found.
    await expect(updateListItems(deps, { actor: member, workspaceId: office.id, listId: list.id, edits: [{ itemId: milk, checked: true }], operationId: randomUUID(), expectedRevision: await revision(list.id) })).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(edit(list.id, [{ itemId: milk, checked: true }], { actor: guest })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(edit(list.id, [{ itemId: milk, checked: true }], { actor: outsider })).rejects.toThrow();
    await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
    await expect(edit(list.id, [{ itemId: milk, checked: true }])).rejects.toBeInstanceOf(NotAuthorizedError);
    expect((await read(list.id)).items[0]?.checked).toBeNull();
  });

  it('gives To-do tasks only titles and ticks', async () => {
    const todo = await newList('Chores', 'TODO');
    const task = await add(todo.id, 'Mow lawn');
    expect(await refusal(edit(todo.id, [{ itemId: task, quantity: '2' }]))).toEqual({ code: 'kind_mismatch', itemIds: [] });
    await edit(todo.id, [{ itemId: task, title: 'Mow the lawn', checked: true }]);
    expect((await read(todo.id)).items[0]).toMatchObject({ title: 'Mow the lawn', quantity: null, checked: { by: { displayName: 'Uma' } } });
  });

  it('answers a retry of an edit with the first answer and refuses a reused operation id', async () => {
    const { list, milk } = await shopping();
    const request = { actor: member, workspaceId: home.id, listId: list.id, edits: [{ itemId: milk, title: 'Oat milk' }], operationId: randomUUID(), expectedRevision: await revision(list.id) };
    const first = await updateListItems(deps, request);
    expect(await updateListItems(deps, request)).toEqual({ ...first, duplicate: true });
    expect(await refusal(updateListItems(deps, { ...request, edits: [{ itemId: milk, title: 'Soy milk' }] }))).toEqual({ code: 'operation_reused', itemIds: [] });
    expect(await refusal(restoreListItems(deps, { actor: member, workspaceId: home.id, listId: list.id, itemIds: [milk], operationId: request.operationId, expectedRevision: await revision(list.id) }))).toEqual({ code: 'operation_reused', itemIds: [] });
    expect((await read(list.id)).items[0]?.title).toBe('Oat milk');
    expect(count('list_item_operations', "kind = 'UPDATE'")).toBe(1);
  });

  it('lists removed items newest first and puts several back at their old places with their state', async () => {
    const { list, milk, eggs, bread } = await shopping();
    await remove(list.id, [eggs]);
    now = new Date('2026-11-12T10:05:00.000Z');
    await remove(list.id, [milk]);
    const removed = await listRemovedListItems(deps, { actor: member, workspaceId: home.id, listId: list.id });
    expect(removed.map((entry) => [entry.item.title, entry.removedAt.toISOString(), entry.removedBy])).toEqual([
      ['Milk', '2026-11-12T10:05:00.000Z', 'Uma'],
      ['Eggs', '2026-11-12T10:00:00.000Z', 'Uma'],
    ]);
    const result = await restore(list.id, [milk, eggs]);
    expect(result.itemIds).toEqual([milk, eggs]);
    expect((await read(list.id)).items.map((item) => [item.id, item.quantity, item.checked !== null])).toEqual([
      [milk, '2', false],
      [eggs, '10', true],
      [bread, null, false],
    ]);
    expect(await listRemovedListItems(deps, { actor: member, workspaceId: home.id, listId: list.id })).toEqual([]);
    expect(count('security_events', "type = 'LIST_ITEMS_RESTORED'")).toBe(1);
  });

  it('refuses to restore live, foreign or unknown items, beyond the limit, for guests and across Workspaces', async () => {
    const { list, milk, bread } = await shopping();
    await remove(list.id, [milk]);
    const unknown = randomUUID();
    expect(await refusal(restore(list.id, [milk, bread]))).toEqual({ code: 'invalid_items', itemIds: [bread] });
    expect(await refusal(restore(list.id, [unknown]))).toEqual({ code: 'invalid_items', itemIds: [unknown] });
    await expect(restore(list.id, [milk], { actor: guest })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(listRemovedListItems(deps, { actor: guest, workspaceId: home.id, listId: list.id })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(listRemovedListItems(deps, { actor: member, workspaceId: office.id, listId: list.id })).rejects.toBeInstanceOf(ListNotFoundError);
    // Fill the List up while Milk is removed: putting it back would pass the limit.
    const full = await newList('Full');
    const keep = await add(full.id, 'Keep');
    await remove(full.id, [keep]);
    for (let n = 0; n < MAX_ITEMS_PER_LIST; n += 1) await add(full.id, `Item ${n}`);
    expect(await refusal(restore(full.id, [keep]))).toEqual({ code: 'limit_reached', itemIds: [] });
    expect((await read(list.id)).items.map((item) => item.id)).not.toContain(milk);
  });
});
