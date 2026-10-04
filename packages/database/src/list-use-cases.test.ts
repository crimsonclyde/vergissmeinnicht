import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ListConflictError,
  ListItemLimitReachedError,
  ListItemNotFoundError,
  ListLimitReachedError,
  ListNotFoundError,
  NotAuthorizedError,
  WorkspaceNotFoundError,
  addListItem,
  addMember,
  changeMemberRole,
  createList,
  createWorkspace,
  deleteList,
  getList,
  listLists,
  removeListItem,
  removeMember,
  renameList,
  restoreList,
  restoreListItem,
  setListItemChecked,
  updateListItem,
  type ListDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, MAX_ITEMS_PER_LIST, MAX_LISTS_PER_WORKSPACE, normalizeEmail, type ListId, type ListItemId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createListRepository } from './list-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

describe('Lists (grocery lists)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let workspaceDeps: WorkspaceDeps;
  let deps: ListDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let guest: User;
  let outsider: User;
  let home: Workspace;
  let office: Workspace;

  const count = (table: string, where = '1') => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
  const events = () => (database.sqlite.prepare("SELECT type FROM audit_events WHERE subject_type = 'list' ORDER BY rowid").all() as { type: string }[]).map((row) => row.type);
  const newList = async (title = 'Groceries', actor = member, workspace = home) => (await createList(deps, { actor, workspaceId: workspace.id, title })).list;
  const add = async (listId: ListId, title: string, extra: { quantity?: string; unit?: string; actor?: User } = {}) =>
    addListItem(deps, { actor: extra.actor ?? member, workspaceId: home.id, listId, title, quantity: extra.quantity, unit: extra.unit });
  const titles = async (listId: ListId) => (await getList(deps, { actor: guest, workspaceId: home.id, listId })).items.map((item) => item.title);

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-10-01T10:00:00.000Z');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, lists: createListRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    editor = await user('editor@example.org', 'Eddie');
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    outsider = await user('outsider@example.org', 'Otto');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    for (const [u, role] of [
      [editor, 'EDITOR'],
      [member, 'USER'],
      [guest, 'GUEST'],
    ] as const) {
      await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: u.email, role });
    }
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: outsider.email, role: 'ADMIN' });
  });

  afterEach(() => database.dispose());

  it('creates a named list, adds items with optional quantity and unit, and keeps their order', async () => {
    const list = await newList('  Weekend shop  ');
    expect(list).toMatchObject({ title: 'Weekend shop', kind: 'GROCERY', revision: 1, deleted: null, created: { by: { userId: member.id, displayName: 'Uma' } } });

    await add(list.id, ' Milk ', { quantity: '2', unit: 'l' });
    await add(list.id, 'Bread');
    const added = await add(list.id, 'Flour', { quantity: '1,50', unit: ' kg ', actor: editor });
    expect(added.list.items.map((item) => [item.title, item.quantity, item.unit])).toEqual([
      ['Milk', '2', 'l'],
      ['Bread', null, null],
      ['Flour', '1.5', 'kg'],
    ]);
    expect(added.list.items.at(-1)).toMatchObject({ id: added.itemId, checked: null, revision: 1, created: { by: { displayName: 'Eddie' } } });
    // Every change raises the List's revision, so other clients notice it.
    expect(added.list.list.revision).toBe(4);

    expect(await listLists(deps, { actor: guest, workspaceId: home.id })).toMatchObject([{ list: { title: 'Weekend shop' }, open: 3, checked: 0 }]);
  });

  it('checks and unchecks items with who and when, idempotently', async () => {
    const list = await newList();
    const { itemId } = await add(list.id, 'Milk');
    now = new Date('2026-10-01T11:00:00.000Z');
    const checked = await setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId, checked: true });
    expect(checked.items[0]?.checked).toEqual({ at: now, by: { userId: member.id, displayName: 'Uma' } });

    // The second shopper ticks the same item a moment later: no conflict, and Uma stays recorded.
    const revision = checked.list.revision;
    now = new Date('2026-10-01T11:00:05.000Z');
    const again = await setListItemChecked(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId, checked: true });
    expect(again.items[0]?.checked?.by.displayName).toBe('Uma');
    expect(again.list.revision).toBe(revision);
    expect((await listLists(deps, { actor: member, workspaceId: home.id }))[0]).toMatchObject({ open: 0, checked: 1 });

    const unchecked = await setListItemChecked(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId, checked: false });
    expect(unchecked.items[0]?.checked).toBeNull();
    expect(unchecked.list.revision).toBe(revision + 1);
  });

  it('edits an item only from the revision the editor saw', async () => {
    const list = await newList();
    const { itemId } = await add(list.id, 'Milk', { quantity: '1' });
    const edited = await updateListItem(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId, title: 'Oat milk', quantity: '2', unit: 'l', expectedRevision: 1 });
    expect(edited.items[0]).toMatchObject({ title: 'Oat milk', quantity: '2', unit: 'l', revision: 2 });
    // Eddie still has revision 1 on screen: his edit must not silently replace Uma's.
    await expect(updateListItem(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId, title: 'Soy milk', expectedRevision: 1 })).rejects.toBeInstanceOf(ListConflictError);
    expect(await titles(list.id)).toEqual(['Oat milk']);
    // Checking does not count as an edit.
    await setListItemChecked(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId, checked: true });
    const cleared = await updateListItem(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId, title: 'Oat milk', quantity: null, unit: '', expectedRevision: 2 });
    expect(cleared.items[0]).toMatchObject({ quantity: null, unit: null, revision: 3 });
    expect(cleared.items[0]?.checked?.by.displayName).toBe('Eddie');
  });

  it('removes an item and puts it back at its place', async () => {
    const list = await newList();
    await add(list.id, 'Milk');
    const { itemId } = await add(list.id, 'Bread');
    await add(list.id, 'Flour');
    await setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId, checked: true });

    const removed = await removeListItem(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId });
    expect(removed.items.map((item) => item.title)).toEqual(['Milk', 'Flour']);
    // A removed item is gone for every other operation …
    await expect(removeListItem(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId })).rejects.toBeInstanceOf(ListItemNotFoundError);
    await expect(setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId, checked: false })).rejects.toBeInstanceOf(ListItemNotFoundError);
    await expect(updateListItem(deps, { actor: member, workspaceId: home.id, listId: list.id, itemId, title: 'x', expectedRevision: 1 })).rejects.toBeInstanceOf(ListItemNotFoundError);
    await add(list.id, 'Eggs');
    // … until it is restored: same place, still purchased.
    const restored = await restoreListItem(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId });
    expect(restored.items.map((item) => item.title)).toEqual(['Milk', 'Bread', 'Flour', 'Eggs']);
    expect(restored.items[1]?.checked?.by.displayName).toBe('Uma');
    await expect(restoreListItem(deps, { actor: editor, workspaceId: home.id, listId: list.id, itemId })).rejects.toBeInstanceOf(ListItemNotFoundError);
  });

  it('renames only from the name the caller saw, and audits List-level changes', async () => {
    const list = await newList('Groceries');
    const renamed = await renameList(deps, { actor: member, workspaceId: home.id, listId: list.id, title: 'Weekly shop', expectedTitle: 'Groceries' });
    expect(renamed.list.title).toBe('Weekly shop');
    await expect(renameList(deps, { actor: editor, workspaceId: home.id, listId: list.id, title: 'Market', expectedTitle: 'Groceries' })).rejects.toBeInstanceOf(ListConflictError);
    // The same name again is not a change (and not an event).
    await renameList(deps, { actor: editor, workspaceId: home.id, listId: list.id, title: 'Weekly shop', expectedTitle: 'Weekly shop' });

    await add(list.id, 'Milk');
    const deleted = await deleteList(deps, { actor: member, workspaceId: home.id, listId: list.id });
    expect(deleted.list.deleted).toMatchObject({ by: { displayName: 'Uma' } });
    expect(await listLists(deps, { actor: member, workspaceId: home.id })).toEqual([]);
    await expect(getList(deps, { actor: member, workspaceId: home.id, listId: list.id })).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(add(list.id, 'Bread')).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(deleteList(deps, { actor: member, workspaceId: home.id, listId: list.id })).rejects.toBeInstanceOf(ListNotFoundError);

    const restored = await restoreList(deps, { actor: member, workspaceId: home.id, listId: list.id });
    expect(restored.list.deleted).toBeNull();
    expect(restored.items.map((item) => item.title)).toEqual(['Milk']);
    await expect(restoreList(deps, { actor: member, workspaceId: home.id, listId: list.id })).rejects.toBeInstanceOf(ListNotFoundError);
    expect(events()).toEqual(['LIST_CREATED', 'LIST_RENAMED', 'LIST_DELETED', 'LIST_RESTORED']);
    // Item changes are recorded on the items, not as events.
    expect(count('audit_events', "subject_type = 'list'")).toBe(4);
  });

  it('lets GUEST read but never change, and keeps other Workspaces out', async () => {
    const list = await newList();
    const { itemId } = await add(list.id, 'Milk');
    const ref = { workspaceId: home.id, listId: list.id };

    expect((await getList(deps, { actor: guest, ...ref })).items).toHaveLength(1);
    const guestWrites = [
      () => createList(deps, { actor: guest, workspaceId: home.id, title: 'Mine' }),
      () => renameList(deps, { actor: guest, ...ref, title: 'Mine', expectedTitle: 'Groceries' }),
      () => deleteList(deps, { actor: guest, ...ref }),
      () => restoreList(deps, { actor: guest, ...ref }),
      () => addListItem(deps, { actor: guest, ...ref, title: 'Beer' }),
      () => updateListItem(deps, { actor: guest, ...ref, itemId, title: 'Beer', expectedRevision: 1 }),
      () => setListItemChecked(deps, { actor: guest, ...ref, itemId, checked: true }),
      () => removeListItem(deps, { actor: guest, ...ref, itemId }),
      () => restoreListItem(deps, { actor: guest, ...ref, itemId }),
    ];
    for (const write of guestWrites) await expect(write()).rejects.toBeInstanceOf(NotAuthorizedError);

    // Otto is no member of Home: every call answers like an unknown Workspace.
    const outsiderCalls = [
      () => listLists(deps, { actor: outsider, workspaceId: home.id }),
      () => getList(deps, { actor: outsider, ...ref }),
      () => addListItem(deps, { actor: outsider, ...ref, title: 'Beer' }),
      () => setListItemChecked(deps, { actor: outsider, ...ref, itemId, checked: true }),
      () => deleteList(deps, { actor: outsider, ...ref }),
    ];
    for (const call of outsiderCalls) await expect(call()).rejects.toBeInstanceOf(WorkspaceNotFoundError);

    // Otto administers Office: Home's List and item ids resolve to nothing under Office's id.
    const viaOffice = { actor: outsider, workspaceId: office.id, listId: list.id };
    await expect(getList(deps, viaOffice)).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(addListItem(deps, { ...viaOffice, title: 'Beer' })).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(setListItemChecked(deps, { ...viaOffice, itemId, checked: true })).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(renameList(deps, { ...viaOffice, title: 'Ours', expectedTitle: 'Groceries' })).rejects.toBeInstanceOf(ListNotFoundError);
    await expect(deleteList(deps, viaOffice)).rejects.toBeInstanceOf(ListNotFoundError);
    // An item of one List is not reachable through another List of the same Workspace either.
    const other = await newList('Hardware store');
    await expect(setListItemChecked(deps, { actor: member, workspaceId: home.id, listId: other.id, itemId, checked: true })).rejects.toBeInstanceOf(ListItemNotFoundError);
    await expect(removeListItem(deps, { actor: member, workspaceId: home.id, listId: other.id, itemId })).rejects.toBeInstanceOf(ListItemNotFoundError);

    const untouched = await getList(deps, { actor: member, ...ref });
    expect(untouched.list).toMatchObject({ title: 'Groceries', deleted: null });
    expect(untouched.items).toMatchObject([{ title: 'Milk', checked: null, revision: 1 }]);
    expect(await listLists(deps, { actor: outsider, workspaceId: office.id })).toEqual([]);
  });

  it('re-checks the actor inside the write transaction', async () => {
    const list = await newList();
    const { itemId } = await add(list.id, 'Milk');
    const ref = { workspaceId: home.id, listId: list.id };
    const at = new Date('2026-10-01T10:05:00.000Z');
    const actor = { kind: 'user', userId: member.id, displayName: member.displayName } as const;
    const asEditor = { actorMay: () => true };

    // Demoted between the use-case's check and the write: the repository refuses with the current role.
    await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
    const guard = { actorMay: (role: string) => role !== 'GUEST' };
    expect(await deps.lists.addItem({ ...ref, title: 'Beer', quantity: null, unit: null, at, maxItems: 10 }, actor, guard)).toEqual({ status: 'forbidden' });
    expect(await deps.lists.setItemChecked({ ...ref, itemId, checked: true, at }, actor, guard)).toEqual({ status: 'forbidden' });
    expect(await deps.lists.delete({ ...ref, at }, actor, guard)).toEqual({ status: 'forbidden' });
    // Removed from the Workspace: refused whatever the guard would allow.
    await removeMember(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id });
    expect(await deps.lists.removeItem({ ...ref, itemId, at }, actor, asEditor)).toEqual({ status: 'forbidden' });
    expect(await deps.lists.create({ workspaceId: home.id, kind: 'GROCERY', title: 'x', at, maxLists: 10 }, actor, asEditor)).toEqual({ status: 'forbidden' });
    await expect(setListItemChecked(deps, { actor: member, ...ref, itemId, checked: true })).rejects.toBeInstanceOf(WorkspaceNotFoundError);

    expect((await getList(deps, { actor: editor, ...ref })).items).toMatchObject([{ title: 'Milk', checked: null }]);
  });

  it('validates names, quantities and units before anything is written', async () => {
    const list = await newList();
    const codeOf = async (run: () => Promise<unknown>) => run().then(() => 'ok', (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : 'other'));
    expect(await codeOf(() => createList(deps, { actor: member, workspaceId: home.id, title: '  ' }))).toBe('list_title_empty');
    expect(await codeOf(() => renameList(deps, { actor: member, workspaceId: home.id, listId: list.id, title: 'x'.repeat(81), expectedTitle: 'Groceries' }))).toBe('list_title_too_long');
    expect(await codeOf(() => add(list.id, ''))).toBe('list_item_title_empty');
    expect(await codeOf(() => add(list.id, 'Milk', { quantity: 'two' }))).toBe('invalid_list_item_quantity');
    expect(await codeOf(() => add(list.id, 'Milk', { unit: 'x'.repeat(17) }))).toBe('list_item_unit_too_long');
    expect(count('lists')).toBe(1);
    expect(count('list_items')).toBe(0);
    expect((await getList(deps, { actor: member, workspaceId: home.id, listId: list.id })).list.revision).toBe(1);
  });

  it('bounds Lists per Workspace and items per List; deleted ones free their place', async () => {
    const at = new Date('2026-10-01T10:00:00.000Z');
    const stamp = at.getTime();
    const first = await newList('List 0');
    const insertList = database.sqlite.prepare(
      "INSERT INTO lists (id, workspace_id, kind, title, revision, created_by_user_id, created_by_display_name, created_at, updated_at) VALUES (?, ?, 'GROCERY', ?, 1, ?, 'Uma', ?, ?)",
    );
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let i = 1; i < MAX_LISTS_PER_WORKSPACE; i++) insertList.run(uuid(i), home.id, `List ${i}`, member.id, stamp, stamp);
    await expect(newList('One too many')).rejects.toBeInstanceOf(ListLimitReachedError);
    // Another Workspace has its own budget.
    await newList('Office snacks', outsider, office);
    await deleteList(deps, { actor: member, workspaceId: home.id, listId: first.id });
    const replacement = await newList('Fits again');
    await expect(restoreList(deps, { actor: member, workspaceId: home.id, listId: first.id })).rejects.toBeInstanceOf(ListLimitReachedError);

    const insertItem = database.sqlite.prepare(
      "INSERT INTO list_items (id, list_id, workspace_id, position, title, revision, created_by_user_id, created_by_display_name, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, 'Uma', ?)",
    );
    for (let i = 0; i < MAX_ITEMS_PER_LIST; i++) insertItem.run(uuid(1000 + i), replacement.id, home.id, i, `Item ${i}`, member.id, stamp);
    await expect(add(replacement.id, 'One too many')).rejects.toBeInstanceOf(ListItemLimitReachedError);
    const removedId = uuid(1000) as ListItemId;
    await removeListItem(deps, { actor: member, workspaceId: home.id, listId: replacement.id, itemId: removedId });
    await add(replacement.id, 'Fits again');
    await expect(restoreListItem(deps, { actor: member, workspaceId: home.id, listId: replacement.id, itemId: removedId })).rejects.toBeInstanceOf(ListItemLimitReachedError);
  });

  it('commits a List change and its audit event together', async () => {
    const list = await newList();
    database.sqlite.exec("CREATE TRIGGER fail_list_audit BEFORE INSERT ON audit_events WHEN NEW.subject_type = 'list' BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");
    await expect(renameList(deps, { actor: member, workspaceId: home.id, listId: list.id, title: 'Renamed', expectedTitle: 'Groceries' })).rejects.toThrow();
    await expect(deleteList(deps, { actor: member, workspaceId: home.id, listId: list.id })).rejects.toThrow();
    await expect(createList(deps, { actor: member, workspaceId: home.id, title: 'Second' })).rejects.toThrow();
    const after = await getList(deps, { actor: member, workspaceId: home.id, listId: list.id });
    expect(after.list).toMatchObject({ title: 'Groceries', revision: 1, deleted: null });
    expect(count('lists')).toBe(1);
  });

  it('keeps an item inside its own Workspace at the database level', async () => {
    const list = await newList();
    const insert = () =>
      database.sqlite
        .prepare("INSERT INTO list_items (id, list_id, workspace_id, position, title, revision, created_by_user_id, created_by_display_name, created_at) VALUES (?, ?, ?, 0, 'Milk', 1, ?, 'Uma', 0)")
        .run('00000000-0000-4000-8000-000000000001', list.id, office.id, member.id);
    expect(insert).toThrow(/FOREIGN KEY/);
    expect(() => database.sqlite.prepare("UPDATE list_items SET quantity = '1 kg'").run()).not.toThrow();
    await add(list.id, 'Milk');
    expect(() => database.sqlite.prepare("UPDATE list_items SET quantity = '1 kg'").run()).toThrow(/CHECK/);
    expect(() => database.sqlite.prepare("UPDATE list_items SET checked_at = 1").run()).toThrow(/CHECK/);
  });
});
