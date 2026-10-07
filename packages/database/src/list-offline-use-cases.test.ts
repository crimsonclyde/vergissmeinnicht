import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addListItem,
  addMember,
  createList,
  createWorkspace,
  deleteList,
  getList,
  listSnapshot,
  removeListItem,
  removeMember,
  replayListChange,
  setListItemChecked,
  updateListItem,
  type ListDeps,
  type RawListChange,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { LIST_CHANGE_KEEP_MS, OFFLINE_CHANGE_MAX_AGE_MS, normalizeEmail, offlineChangeTime, type ListId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createListRepository } from './list-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository, createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

describe('Lists changed offline (17.5)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let workspaceDeps: WorkspaceDeps;
  let deps: ListDeps;
  let ada: User;
  let bea: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;

  const at = (time: string) => new Date(`2026-10-07T${time}:00.000Z`);
  /** Bea's phone sends a change it made at `madeAt` (device clock). */
  const replay = (change: RawListChange, madeAt: Date, options: { actor?: User; id?: string; workspace?: Workspace; madeBy?: string } = {}) => {
    const actor = options.actor ?? bea;
    return replayListChange(deps, {
      actor,
      workspaceId: (options.workspace ?? home).id,
      clientChangeId: options.id ?? randomUUID(),
      madeBy: options.madeBy ?? actor.id,
      deviceTime: madeAt,
      change,
    });
  };
  const reason = (run: Promise<unknown>) => run.then(() => undefined, (caught: unknown) => (caught as Error).name);
  const list = async (listId: ListId) => getList(deps, { actor: gus, workspaceId: home.id, listId });
  const groceries = async () => {
    now = at('08:00');
    const created = (await createList(deps, { actor: ada, workspaceId: home.id, title: 'Groceries' })).list;
    const milk = (await addListItem(deps, { actor: ada, workspaceId: home.id, listId: created.id, title: 'Milk', quantity: '1' })).itemId;
    const bread = (await addListItem(deps, { actor: ada, workspaceId: home.id, listId: created.id, title: 'Bread' })).itemId;
    return { listId: created.id, milk, bread };
  };

  beforeEach(async () => {
    database = createTestDatabase();
    now = at('08:00');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, lists: createListRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    ada = await user('ada@example.org', 'Ada', true);
    bea = await user('bea@example.org', 'Bea');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace(workspaceDeps, { actor: ada, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: ada, name: 'Office' });
    await addMember(workspaceDeps, { actor: ada, workspaceId: home.id, email: bea.email, role: 'USER' });
    await addMember(workspaceDeps, { actor: ada, workspaceId: home.id, email: gus.email, role: 'GUEST' });
    await addMember(workspaceDeps, { actor: ada, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
  });
  afterEach(() => database.dispose());

  it('applies a change once: sending it again repeats the first answer and changes nothing', async () => {
    const { listId } = await groceries();
    const eggs = randomUUID();
    const id = randomUUID();
    now = at('10:30');
    const first = await replay({ kind: 'addItem', listId, itemId: eggs, title: 'Eggs', quantity: '6', unit: null }, at('09:50'), { id });
    expect(first).toMatchObject({ outcome: 'APPLIED', duplicate: false });
    expect(first.list?.items.map((item) => item.title)).toEqual(['Milk', 'Bread', 'Eggs']);
    const revision = (await list(listId)).list.revision;
    const again = await replay({ kind: 'addItem', listId, itemId: eggs, title: 'Eggs', quantity: '6', unit: null }, at('09:50'), { id });
    expect(again).toMatchObject({ outcome: 'APPLIED', duplicate: true });
    expect((await list(listId)).list.revision).toBe(revision);
    expect((await list(listId)).items.map((item) => item.title)).toEqual(['Milk', 'Bread', 'Eggs']);
    // The item made offline can be changed offline afterwards: its id is the device's.
    expect(await replay({ kind: 'checkItem', listId, itemId: eggs, checked: true }, at('09:55'))).toMatchObject({ outcome: 'APPLIED' });
    expect((await list(listId)).items.find((item) => item.id === eggs)?.checked).toMatchObject({ at: at('09:55'), by: { displayName: 'Bea' } });
  });

  it('merges changes to different items from two devices', async () => {
    const { listId, milk, bread } = await groceries();
    now = at('10:30');
    await replay({ kind: 'checkItem', listId, itemId: milk, checked: true }, at('09:50'));
    await replay({ kind: 'checkItem', listId, itemId: bread, checked: true }, at('09:40'), { actor: ada });
    expect((await list(listId)).items.map((item) => [item.title, item.checked?.by.displayName])).toEqual([
      ['Milk', 'Bea'],
      ['Bread', 'Ada'],
    ]);
  });

  it('for the same item the later change wins, by when it was made — and says whose won', async () => {
    const { listId, milk } = await groceries();
    // Bea, offline in the shop, sets Milk to 3 at 09:50; Ada, online at home, to 2 at 10:00.
    now = at('10:00');
    const shown = await list(listId);
    await updateListItem(deps, { actor: ada, workspaceId: home.id, listId, itemId: milk, title: 'Milk', quantity: '2', expectedRevision: shown.items[0]?.revision ?? 0 });
    now = at('10:30');
    const late = await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '3', unit: null }, at('09:50'));
    expect(late).toMatchObject({ outcome: 'OVERRIDDEN', by: 'Ada', byAt: at('10:00') });
    expect((await list(listId)).items[0]?.quantity).toBe('2');
    // Made after Ada's change: it wins.
    expect(await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '4', unit: 'l' }, at('10:05'))).toMatchObject({ outcome: 'APPLIED' });
    expect((await list(listId)).items[0]).toMatchObject({ quantity: '4', unit: 'l' });
    // Checking is decided on its own: an edit and a check of the same item both apply.
    expect(await replay({ kind: 'checkItem', listId, itemId: milk, checked: true }, at('09:30'))).toMatchObject({ outcome: 'APPLIED' });
    now = at('10:40');
    await setListItemChecked(deps, { actor: ada, workspaceId: home.id, listId, itemId: milk, checked: false });
    now = at('11:00');
    expect(await replay({ kind: 'checkItem', listId, itemId: milk, checked: true }, at('10:35'))).toMatchObject({ outcome: 'OVERRIDDEN', by: 'Ada', byAt: at('10:40') });
    expect((await list(listId)).items[0]?.checked).toBeNull();
  });

  it('a removal wins over an edit or a check, whenever they were made', async () => {
    const { listId, milk, bread } = await groceries();
    now = at('10:00');
    await removeListItem(deps, { actor: ada, workspaceId: home.id, listId, itemId: milk });
    now = at('10:30');
    expect(await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '3', unit: null }, at('10:10'))).toMatchObject({ outcome: 'ITEM_REMOVED', by: 'Ada', byAt: at('10:00') });
    expect(await replay({ kind: 'checkItem', listId, itemId: milk, checked: true }, at('10:20'))).toMatchObject({ outcome: 'ITEM_REMOVED', by: 'Ada' });
    expect(await replay({ kind: 'removeItem', listId, itemId: milk }, at('09:00'))).toMatchObject({ outcome: 'APPLIED' });
    // An offline removal beats a later online edit too.
    now = at('10:40');
    const shown = await list(listId);
    await updateListItem(deps, { actor: ada, workspaceId: home.id, listId, itemId: bread, title: 'Rye bread', expectedRevision: shown.items[0]?.revision ?? 0 });
    now = at('11:00');
    expect(await replay({ kind: 'removeItem', listId, itemId: bread }, at('10:15'))).toMatchObject({ outcome: 'APPLIED' });
    expect((await list(listId)).items).toEqual([]);
  });

  it('a deleted List wins over offline changes to it; deleting offline wins over changes made meanwhile', async () => {
    const { listId, milk } = await groceries();
    now = at('10:00');
    await deleteList(deps, { actor: ada, workspaceId: home.id, listId });
    now = at('10:30');
    for (const change of [
      { kind: 'renameList', listId, title: 'Weekly' },
      { kind: 'addItem', listId, itemId: randomUUID(), title: 'Eggs', quantity: null, unit: null },
      { kind: 'checkItem', listId, itemId: milk, checked: true },
    ] satisfies RawListChange[]) {
      expect(await replay(change, at('10:20'))).toMatchObject({ outcome: 'LIST_DELETED', by: 'Ada', byAt: at('10:00'), list: null });
    }
    const other = await groceries();
    now = at('10:40');
    await setListItemChecked(deps, { actor: ada, workspaceId: home.id, listId: other.listId, itemId: other.milk, checked: true });
    now = at('11:00');
    expect(await replay({ kind: 'deleteList', listId: other.listId }, at('10:10'))).toMatchObject({ outcome: 'APPLIED', list: null });
  });

  it('a List created offline is created once, with the device’s id; ids of something else are refused', async () => {
    const listId = randomUUID();
    const id = randomUUID();
    now = at('10:30');
    expect(await replay({ kind: 'createList', listId, title: '  Camping  ' }, at('09:00'), { id })).toMatchObject({ outcome: 'APPLIED', list: { list: { id: listId, title: 'Camping' } } });
    expect(await replay({ kind: 'createList', listId, title: 'Camping' }, at('09:00'), { id })).toMatchObject({ duplicate: true });
    expect(await reason(replay({ kind: 'createList', listId, title: 'Again' }, at('09:00')))).toBe('ListConflictError');
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM lists').get()).toEqual({ n: 1 });
    // An id of another Workspace's List or item cannot be taken over — and its List is not found here.
    const theirs = (await createList(deps, { actor: otto, workspaceId: office.id, title: 'Office supplies' })).list;
    const pen = (await addListItem(deps, { actor: otto, workspaceId: office.id, listId: theirs.id, title: 'Pens' })).itemId;
    expect(await reason(replay({ kind: 'createList', listId: theirs.id, title: 'Mine' }, at('09:00')))).toBe('ListConflictError');
    expect(await reason(replay({ kind: 'addItem', listId, itemId: pen, title: 'Pens', quantity: null, unit: null }, at('09:00')))).toBe('ListConflictError');
    expect(await replay({ kind: 'checkItem', listId: theirs.id, itemId: pen, checked: true }, at('09:00'))).toMatchObject({ outcome: 'NOT_FOUND', list: null });
    expect(database.sqlite.prepare('SELECT checked_at FROM list_items WHERE id = ?').get(pen)).toEqual({ checked_at: null });
    // A change id used for one List cannot be reused for another.
    expect(await reason(replay({ kind: 'renameList', listId: theirs.id, title: 'x' }, at('09:00'), { id }))).toBe('ListConflictError');
  });

  it('is authorized like the same change made online today: role, membership, tool and account', async () => {
    const { listId, milk } = await groceries();
    now = at('10:30');
    const check = { kind: 'checkItem', listId, itemId: milk, checked: true } satisfies RawListChange;
    expect(await reason(replay(check, at('10:00'), { actor: gus }))).toBe('NotAuthorizedError');
    expect(await reason(replay(check, at('10:00'), { actor: otto }))).toBe('WorkspaceNotFoundError');
    expect(await reason(replay(check, at('10:00'), { madeBy: ada.id }))).toBe('OfflineAccountMismatchError');
    database.sqlite.prepare("UPDATE workspace_tools SET enabled = 0 WHERE workspace_id = ? AND tool = 'LISTS'").run(home.id);
    expect(await reason(replay(check, at('10:00')))).toBe('ToolNotEnabledError');
    database.sqlite.prepare("UPDATE workspace_tools SET enabled = 1 WHERE workspace_id = ? AND tool = 'LISTS'").run(home.id);
    await removeMember(workspaceDeps, { actor: ada, workspaceId: home.id, userId: bea.id });
    expect(await reason(replay(check, at('10:00')))).toBe('WorkspaceNotFoundError');
    expect((await list(listId)).items[0]?.checked).toBeNull();
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM list_client_changes').get()).toEqual({ n: 0 });
  });

  it('counts a change at the device’s time, but never in the future and never too long ago', async () => {
    now = at('10:30');
    expect(offlineChangeTime(at('23:00'), now)).toEqual(now);
    expect(offlineChangeTime(new Date('2025-01-01T00:00:00Z'), now)).toEqual(new Date(now.getTime() - OFFLINE_CHANGE_MAX_AGE_MS));
    expect(offlineChangeTime(new Date(Number.NaN), now)).toEqual(now);
    const { listId, milk } = await groceries();
    now = at('10:30');
    // A phone whose clock runs a day ahead: its change counts as made when it arrived, not tomorrow …
    await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '9', unit: null }, new Date('2026-10-08T10:00:00Z'));
    expect(database.sqlite.prepare('SELECT content_changed_at AS at FROM list_items WHERE id = ?').get(milk)).toEqual({ at: at('10:30').getTime() });
    // … so a change made after that, sent later, still wins.
    now = at('11:00');
    expect(await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '2', unit: null }, at('10:45'), { actor: ada })).toMatchObject({ outcome: 'APPLIED' });
    expect(await replay({ kind: 'editItem', listId, itemId: milk, title: 'Milk', quantity: '5', unit: null }, at('10:20'))).toMatchObject({ outcome: 'OVERRIDDEN', by: 'Ada', byAt: at('10:45') });
  });

  it('records List-level changes in the history, marked offline, together with the change — or nothing', async () => {
    const listId = randomUUID();
    now = at('10:30');
    await replay({ kind: 'createList', listId, title: 'Camping' }, at('09:00'));
    await replay({ kind: 'renameList', listId, title: 'Camping trip' }, at('09:05'));
    const history = database.sqlite.prepare("SELECT type, actor_display_name AS actor, metadata FROM audit_events WHERE subject_type = 'list' ORDER BY rowid").all() as { type: string; actor: string; metadata: string }[];
    expect(history.map((row) => [row.type, row.actor, JSON.parse(row.metadata).offline])).toEqual([
      ['LIST_CREATED', 'Bea', true],
      ['LIST_RENAMED', 'Bea', true],
    ]);
    database.sqlite.exec("CREATE TRIGGER audit_fails BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    const failing = randomUUID();
    await expect(replay({ kind: 'createList', listId: failing, title: 'Never' }, at('09:10'))).rejects.toThrow();
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM lists WHERE id = ?').get(failing)).toEqual({ n: 0 });
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM list_client_changes WHERE list_id = ?').get(failing)).toEqual({ n: 0 });
  });

  it('forgets replayed changes after the keep period', async () => {
    const { listId, milk } = await groceries();
    now = at('10:30');
    await replay({ kind: 'checkItem', listId, itemId: milk, checked: true }, at('10:00'));
    now = new Date(now.getTime() + LIST_CHANGE_KEEP_MS + 60_000);
    await replay({ kind: 'checkItem', listId, itemId: milk, checked: false }, now);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM list_client_changes').get()).toEqual({ n: 1 });
  });

  it('gives a device every List of the Workspace with its items — for guests too, never another Workspace’s', async () => {
    const { listId } = await groceries();
    const gone = (await createList(deps, { actor: ada, workspaceId: home.id, title: 'Old' })).list;
    await deleteList(deps, { actor: ada, workspaceId: home.id, listId: gone.id });
    await createList(deps, { actor: otto, workspaceId: office.id, title: 'Office supplies' });
    const snapshot = await listSnapshot(deps, { actor: gus, workspaceId: home.id });
    expect(snapshot.map((entry) => [entry.list.id, entry.items.map((item) => item.title)])).toEqual([[listId, ['Milk', 'Bread']]]);
    expect(await reason(listSnapshot(deps, { actor: otto, workspaceId: home.id }))).toBe('WorkspaceNotFoundError');
    database.sqlite.prepare("UPDATE workspace_tools SET enabled = 0 WHERE workspace_id = ? AND tool = 'LISTS'").run(home.id);
    expect(await reason(listSnapshot(deps, { actor: gus, workspaceId: home.id }))).toBe('ToolNotEnabledError');
  });
});
