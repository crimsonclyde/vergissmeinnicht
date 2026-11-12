import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ListBatchError,
  ListNotFoundError,
  NotAuthorizedError,
  WorkspaceNotFoundError,
  addListItem,
  addMember,
  changeMemberRole,
  createList,
  createWorkspace,
  getList,
  listLists,
  moveListItems,
  removeListItem,
  removeListItems,
  restoreListItem,
  setListItemChecked,
  updateListItem,
  type ListDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { LIST_CHANGE_KEEP_MS, MAX_ITEMS_PER_LIST, normalizeEmail, type ListId, type ListItemId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createListRepository } from './list-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository, createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

/** 36.18: moving items between Lists and removing several at once, atomically and idempotently. */
describe('Lists: move and batch removal', () => {
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
  const add = async (listId: ListId, title: string, quantity?: string, unit?: string) =>
    (await addListItem(deps, { actor: member, workspaceId: home.id, listId, title, quantity, unit })).itemId;
  const read = (listId: ListId, workspace = home) => getList(deps, { actor: member, workspaceId: workspace.id, listId });
  const revision = async (listId: ListId) => (await read(listId)).list.revision;
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ListBatchError) return { code: error.code, itemIds: [...error.itemIds] };
      throw error;
    }
    throw new Error('Expected a refusal');
  };

  /** Shopping with Milk (2 l), Eggs (checked) and Bread; Vario empty. */
  async function shoppingAndVario() {
    const shopping = await newList('Shopping');
    const vario = await newList('Vario');
    const milk = await add(shopping.id, 'Milk', '2', 'l');
    const eggs = await add(shopping.id, 'Eggs', '10');
    const bread = await add(shopping.id, 'Bread');
    await setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemId: eggs, checked: true });
    return { shopping, vario, milk, eggs, bread };
  }

  const move = async (input: { sourceListId: ListId; destinationListId: ListId; itemIds: readonly string[]; operationId?: string; actor?: User; workspace?: Workspace }) =>
    moveListItems(deps, {
      actor: input.actor ?? member,
      workspaceId: (input.workspace ?? home).id,
      sourceListId: input.sourceListId,
      destinationListId: input.destinationListId,
      itemIds: input.itemIds,
      operationId: input.operationId ?? randomUUID(),
      expectedSourceRevision: await revision(input.sourceListId),
      expectedDestinationRevision: await revision(input.destinationListId),
    });

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

  it('moves one item with its id, text, quantity, unit and checked state, raising both revisions once', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    const before = (await read(shopping.id)).items.find((item) => item.id === milk);
    const [sourceRevision, destinationRevision] = [await revision(shopping.id), await revision(vario.id)];

    const result = await move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk] });

    expect(result).toEqual({ duplicate: false, itemIds: [milk], revisions: { [shopping.id]: sourceRevision + 1, [vario.id]: destinationRevision + 1 } });
    expect((await read(shopping.id)).items.map((item) => item.title)).toEqual(['Eggs', 'Bread']);
    const moved = (await read(vario.id)).items;
    expect(moved).toEqual([{ ...before, listId: vario.id, position: 0 }]);
    expect(count('list_items')).toBe(3);
  });

  it('moves several checked and unchecked items into an empty List in their List order, and keeps the counts right', async () => {
    const { shopping, vario, milk, eggs, bread } = await shoppingAndVario();
    const keep = await add(shopping.id, 'Butter', '250', 'g');

    // Asked for in another order: they arrive in the order they had on the source List.
    const result = await move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [bread, eggs, milk] });
    expect(result.itemIds).toEqual([milk, eggs, bread]);

    const destination = (await read(vario.id)).items;
    expect(destination.map(({ id, title, quantity, unit, position }) => ({ id, title, quantity, unit, position }))).toEqual([
      { id: milk, title: 'Milk', quantity: '2', unit: 'l', position: 0 },
      { id: eggs, title: 'Eggs', quantity: '10', unit: null, position: 1 },
      { id: bread, title: 'Bread', quantity: null, unit: null, position: 2 },
    ]);
    expect(destination.find((item) => item.id === eggs)?.checked).toMatchObject({ by: { displayName: 'Uma' } });
    expect((await read(shopping.id)).items.map((item) => item.id)).toEqual([keep]);
    expect((await listLists(deps, { actor: member, workspaceId: home.id })).map(({ list, open, checked }) => ({ title: list.title, open, checked })).sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: 'Shopping', open: 1, checked: 0 },
      { title: 'Vario', open: 2, checked: 1 },
    ]);
  });

  it('appends after existing items and never merges entries with the same title', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    const existing = await add(vario.id, 'Milk', '1', 'l');
    await move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk] });
    expect((await read(vario.id)).items.map(({ id, quantity }) => ({ id, quantity }))).toEqual([
      { id: existing, quantity: '1' },
      { id: milk, quantity: '2' },
    ]);
  });

  it('keeps moved items fully usable on the destination List', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    await move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk] });
    const ref = { actor: member, workspaceId: home.id, listId: vario.id, itemId: milk };
    await updateListItem(deps, { ...ref, title: 'Oat milk', quantity: '2', unit: 'l', expectedRevision: 1 });
    await setListItemChecked(deps, { ...ref, checked: true });
    await removeListItem(deps, ref);
    await restoreListItem(deps, ref);
    expect((await read(vario.id)).items).toMatchObject([{ id: milk, title: 'Oat milk', checked: { by: { displayName: 'Uma' } } }]);
    // The source List no longer reaches it.
    await expect(setListItemChecked(deps, { ...ref, listId: shopping.id, checked: false })).rejects.toThrow();
  });

  it('refuses a move to the same List', async () => {
    const { shopping, milk } = await shoppingAndVario();
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: shopping.id, itemIds: [milk] }))).toEqual({ code: 'same_list', itemIds: [] });
    expect((await read(shopping.id)).items).toHaveLength(3);
  });

  it('refuses a move across Workspaces, in either direction', async () => {
    const { shopping, milk } = await shoppingAndVario();
    const elsewhere = await newList('Office snacks', 'GROCERY', office);
    // Uma belongs to both Workspaces, yet a List of the other Workspace is not found under this one.
    await expect(
      moveListItems(deps, { actor: member, workspaceId: home.id, sourceListId: shopping.id, destinationListId: elsewhere.id, itemIds: [milk], operationId: randomUUID(), expectedSourceRevision: await revision(shopping.id), expectedDestinationRevision: 1 }),
    ).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(
      moveListItems(deps, { actor: member, workspaceId: office.id, sourceListId: shopping.id, destinationListId: elsewhere.id, itemIds: [milk], operationId: randomUUID(), expectedSourceRevision: await revision(shopping.id), expectedDestinationRevision: 1 }),
    ).rejects.toBeInstanceOf(ListNotFoundError);
    expect((await read(shopping.id)).items).toHaveLength(3);
    expect((await read(elsewhere.id, office)).items).toEqual([]);
  });

  it('refuses guests, non-members and accounts demoted or removed meanwhile', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    const args = { sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk] };
    await expect(move({ ...args, actor: guest })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(removeListItems(deps, { actor: guest, workspaceId: home.id, listId: shopping.id, itemIds: [milk], operationId: randomUUID(), expectedRevision: await revision(shopping.id) })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(move({ ...args, actor: outsider })).rejects.toBeInstanceOf(WorkspaceNotFoundError);

    // Demoted between the use case's check and the write: the transaction refuses with the current role.
    const at = now;
    const userActor = { kind: 'user', userId: member.id, displayName: member.displayName } as const;
    const guard = { tool: 'LISTS' as const, actorMay: (role: string) => role !== 'GUEST' };
    await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
    const common = { workspaceId: home.id, operationId: randomUUID(), itemIds: [milk], at, keepSince: new Date(0) };
    expect(await deps.lists.moveItems({ ...common, sourceListId: shopping.id, destinationListId: vario.id, expectedSourceRevision: 5, expectedDestinationRevision: 1, maxItems: MAX_ITEMS_PER_LIST }, userActor, guard)).toEqual({ status: 'forbidden' });
    expect(await deps.lists.removeItems({ ...common, listId: shopping.id, expectedRevision: 5 }, userActor, guard)).toEqual({ status: 'forbidden' });
    expect(count('list_item_operations')).toBe(0);
    expect((await getList(deps, { actor: guest, workspaceId: home.id, listId: shopping.id })).items).toHaveLength(3);
  });

  it('refuses a stale revision of either List without changing anything', async () => {
    const { shopping, vario, milk, bread } = await shoppingAndVario();
    const sourceRevision = await revision(shopping.id);
    const destinationRevision = await revision(vario.id);
    const attempt = (operationId = randomUUID()) =>
      moveListItems(deps, { actor: member, workspaceId: home.id, sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk], operationId, expectedSourceRevision: sourceRevision, expectedDestinationRevision: destinationRevision });

    // Someone adds to the destination after it was read.
    await add(vario.id, 'Cheese');
    expect(await refusal(attempt())).toEqual({ code: 'stale_revision', itemIds: [] });
    // Someone checks an item on the source after it was read.
    await setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemId: bread, checked: true });
    expect(await refusal(attempt())).toEqual({ code: 'stale_revision', itemIds: [] });
    expect(await refusal(removeListItems(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemIds: [milk], operationId: randomUUID(), expectedRevision: sourceRevision }))).toEqual({ code: 'stale_revision', itemIds: [] });
    expect((await read(shopping.id)).items).toHaveLength(3);
    expect((await read(vario.id)).items.map((item) => item.title)).toEqual(['Cheese']);
    expect(count('list_item_operations')).toBe(0);
  });

  it('lets only one of two concurrent moves from the same reviewed revisions through', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    const pantry = await newList('Pantry');
    const reviewed = { actor: member, workspaceId: home.id, sourceListId: shopping.id, itemIds: [milk], expectedSourceRevision: await revision(shopping.id) };
    const results = await Promise.allSettled([
      moveListItems(deps, { ...reviewed, destinationListId: vario.id, operationId: randomUUID(), expectedDestinationRevision: await revision(vario.id) }),
      moveListItems(deps, { ...reviewed, destinationListId: pantry.id, operationId: randomUUID(), expectedDestinationRevision: await revision(pantry.id) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'stale_revision' });
    expect(count('list_items', `id = '${milk}'`)).toBe(1);
    expect((await read(vario.id)).items.length + (await read(pantry.id)).items.length).toBe(1);
  });

  it('refuses missing, foreign, removed and repeated item ids as a whole', async () => {
    const { shopping, vario, milk, eggs, bread } = await shoppingAndVario();
    const pantry = await newList('Pantry');
    const foreign = await add(pantry.id, 'Rice');
    const unknown = randomUUID();
    await removeListItem(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemId: bread });

    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk, unknown] }))).toEqual({ code: 'invalid_items', itemIds: [unknown] });
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk, foreign, bread] }))).toEqual({ code: 'invalid_items', itemIds: [foreign, bread] });
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk, eggs, milk] }))).toEqual({ code: 'duplicate_item_ids', itemIds: [milk] });
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [] }))).toEqual({ code: 'invalid_items', itemIds: [] });
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: ['not-an-id'] }))).toEqual({ code: 'invalid_items', itemIds: [] });
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk], operationId: 'retry-1' }))).toEqual({ code: 'invalid_operation_id', itemIds: [] });

    expect((await read(shopping.id)).items.map((item) => item.id)).toEqual([milk, eggs]);
    expect((await read(vario.id)).items).toEqual([]);
    expect((await read(pantry.id)).items.map((item) => item.id)).toEqual([foreign]);
  });

  it('refuses moves between a Shopping and a To-do List, and beyond the item limit', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    const todo = await newList('Chores', 'TODO');
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: todo.id, itemIds: [milk] }))).toEqual({ code: 'kind_mismatch', itemIds: [] });

    const full = await newList('Full');
    const values = Array.from({ length: MAX_ITEMS_PER_LIST }, (_, position) => `('${randomUUID()}', '${full.id}', '${home.id}', ${position}, 'Item', 1, '${member.id}', 'Uma', 0, 0, 'Uma', 0, 'Uma')`);
    database.sqlite.exec(`INSERT INTO list_items (id, list_id, workspace_id, position, title, revision, created_by_user_id, created_by_display_name, created_at, content_changed_at, content_changed_by_display_name, check_changed_at, check_changed_by_display_name) VALUES ${values.join(', ')}`);
    expect(await refusal(move({ sourceListId: shopping.id, destinationListId: full.id, itemIds: [milk] }))).toEqual({ code: 'limit_reached', itemIds: [] });
    expect((await read(shopping.id)).items).toHaveLength(3);
    expect((await read(vario.id)).items).toEqual([]);
  });

  it('rolls the whole move back when any part of the transaction fails', async () => {
    const { shopping, vario, milk, eggs } = await shoppingAndVario();
    const revisions = [await revision(shopping.id), await revision(vario.id)];
    database.sqlite.exec("CREATE TRIGGER fail_move BEFORE INSERT ON security_events WHEN NEW.type = 'LIST_ITEMS_MOVED' BEGIN SELECT RAISE(ABORT, 'history failed'); END;");
    await expect(move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk, eggs] })).rejects.toThrow();
    database.sqlite.exec("CREATE TRIGGER fail_remove BEFORE INSERT ON security_events WHEN NEW.type = 'LIST_ITEMS_REMOVED' BEGIN SELECT RAISE(ABORT, 'history failed'); END;");
    await expect(removeListItems(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemIds: [milk, eggs], operationId: randomUUID(), expectedRevision: revisions[0] ?? 0 })).rejects.toThrow();

    expect((await read(shopping.id)).items).toHaveLength(3);
    expect((await read(vario.id)).items).toEqual([]);
    expect([await revision(shopping.id), await revision(vario.id)]).toEqual(revisions);
    expect(count('list_item_operations')).toBe(0);
  });

  it('answers a retry with the same operation id with the first answer and never moves twice', async () => {
    const { shopping, vario, milk, eggs } = await shoppingAndVario();
    const pantry = await newList('Pantry');
    const request = { actor: member, workspaceId: home.id, sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk, eggs], operationId: randomUUID(), expectedSourceRevision: await revision(shopping.id), expectedDestinationRevision: await revision(vario.id) };

    const first = await moveListItems(deps, request);
    // The answer was lost; the same request comes again, also with the ids in another order.
    expect(await moveListItems(deps, request)).toEqual({ ...first, duplicate: true });
    expect(await moveListItems(deps, { ...request, itemIds: [eggs, milk] })).toEqual({ ...first, duplicate: true });
    expect((await read(vario.id)).items.map((item) => item.id)).toEqual([milk, eggs]);
    expect(await revision(vario.id)).toBe(first.revisions[vario.id]);

    // The same id for another request is refused, whoever sends it.
    expect(await refusal(moveListItems(deps, { ...request, destinationListId: pantry.id, expectedDestinationRevision: await revision(pantry.id) }))).toEqual({ code: 'operation_reused', itemIds: [] });
    expect(await refusal(removeListItems(deps, { actor: member, workspaceId: home.id, listId: vario.id, itemIds: [milk], operationId: request.operationId, expectedRevision: await revision(vario.id) }))).toEqual({ code: 'operation_reused', itemIds: [] });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: outsider.email, role: 'USER' });
    expect(await refusal(moveListItems(deps, { ...request, actor: outsider }))).toEqual({ code: 'operation_reused', itemIds: [] });
    expect((await read(pantry.id)).items).toEqual([]);
    expect(count('list_item_operations')).toBe(1);
    expect(count('security_events', "type = 'LIST_ITEMS_MOVED'")).toBe(1);
  });

  it('removes one item, and several checked and unchecked items at once', async () => {
    const { shopping, milk, eggs, bread } = await shoppingAndVario();
    const butter = await add(shopping.id, 'Butter');
    const single = await removeListItems(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemIds: [bread], operationId: randomUUID(), expectedRevision: await revision(shopping.id) });
    expect(single).toEqual({ duplicate: false, itemIds: [bread], revisions: { [shopping.id]: (await revision(shopping.id)) } });

    const batch = await removeListItems(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemIds: [eggs, milk], operationId: randomUUID(), expectedRevision: await revision(shopping.id) });
    expect(batch.itemIds).toEqual([milk, eggs]);
    expect(batch.revisions[shopping.id]).toBe((single.revisions[shopping.id] ?? 0) + 1);
    expect((await read(shopping.id)).items.map((item) => item.id)).toEqual([butter]);
    const summary = (await listLists(deps, { actor: member, workspaceId: home.id })).map(({ list, open, checked }) => ({ title: list.title, open, checked }));
    expect(summary.sort((a, b) => a.title.localeCompare(b.title))).toEqual([{ title: 'Shopping', open: 1, checked: 0 }, { title: 'Vario', open: 0, checked: 0 }]);
    // Soft removal, exactly like the app's: who removed it is kept, and each item can be put back.
    expect(database.sqlite.prepare('SELECT deleted_by_display_name AS by FROM list_items WHERE id = ?').get(eggs)).toEqual({ by: 'Uma' });
    await restoreListItem(deps, { actor: member, workspaceId: home.id, listId: shopping.id, itemId: eggs });
    expect((await read(shopping.id)).items.find((item) => item.id === eggs)).toMatchObject({ title: 'Eggs', quantity: '10', checked: { by: { displayName: 'Uma' } } });
    expect(count('security_events', "type = 'LIST_ITEMS_REMOVED'")).toBe(2);
  });

  it('refuses already removed items without removing the others, and a retry never removes unrelated items', async () => {
    const { shopping, milk, eggs, bread } = await shoppingAndVario();
    const request = { actor: member, workspaceId: home.id, listId: shopping.id, itemIds: [milk, eggs], operationId: randomUUID(), expectedRevision: await revision(shopping.id) };
    const first = await removeListItems(deps, request);

    // Asking again for an item that is already gone, under a new operation: refused as a whole.
    expect(await refusal(removeListItems(deps, { ...request, itemIds: [milk, bread], operationId: randomUUID(), expectedRevision: await revision(shopping.id) }))).toEqual({ code: 'invalid_items', itemIds: [milk] });
    expect((await read(shopping.id)).items.map((item) => item.id)).toEqual([bread]);

    // Someone adds a new Milk; the lost-answer retry repeats the first answer and touches nothing.
    const newMilk = await add(shopping.id, 'Milk', '2', 'l');
    expect(await removeListItems(deps, request)).toEqual({ ...first, duplicate: true });
    expect((await read(shopping.id)).items.map((item) => item.id)).toEqual([bread, newMilk]);
  });

  it('forgets operations after the keep period', async () => {
    const { shopping, vario, milk } = await shoppingAndVario();
    await move({ sourceListId: shopping.id, destinationListId: vario.id, itemIds: [milk] });
    expect(count('list_item_operations')).toBe(1);
    now = new Date(now.getTime() + LIST_CHANGE_KEEP_MS + 1);
    await removeListItems(deps, { actor: member, workspaceId: home.id, listId: vario.id, itemIds: [milk], operationId: randomUUID(), expectedRevision: await revision(vario.id) });
    expect(count('list_item_operations')).toBe(1);
  });

  it('leaves the existing single-item operations unchanged', async () => {
    const { shopping, milk } = await shoppingAndVario();
    const ref = { actor: member, workspaceId: home.id, listId: shopping.id, itemId: milk as ListItemId };
    const removed = await removeListItem(deps, ref);
    expect(removed.items.map((item) => item.title)).toEqual(['Eggs', 'Bread']);
    const restored = await restoreListItem(deps, ref);
    expect(restored.items.map((item) => item.title)).toEqual(['Milk', 'Eggs', 'Bread']);
    expect(count('list_item_operations')).toBe(0);
  });
});
