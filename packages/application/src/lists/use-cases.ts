import {
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_WORKSPACE,
  normalizeListItemQuantity,
  normalizeListItemTitle,
  normalizeListItemUnit,
  normalizeListTitle,
  type ListId,
  type ListItemId,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { ListRepository, ListSummary, ListWithItems } from '../ports/list-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ListConflictError, ListItemLimitReachedError, ListItemNotFoundError, ListLimitReachedError, ListNotFoundError } from './errors.ts';

export interface ListDeps {
  readonly workspaces: WorkspaceRepository;
  readonly lists: ListRepository;
  readonly clock: Clock;
}

/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const edit: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'list.edit') };

type Refused = 'forbidden' | 'list_not_found' | 'item_not_found' | 'conflict';

function refuse(status: Refused): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'list_not_found':
      throw new ListNotFoundError();
    case 'item_not_found':
      throw new ListItemNotFoundError();
    case 'conflict':
      throw new ListConflictError();
  }
}

interface ListRef {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
  readonly listId: ListId;
}
interface ItemRef extends ListRef {
  readonly itemId: ListItemId;
}
interface ItemContent {
  readonly title: string;
  readonly quantity?: string | null | undefined;
  readonly unit?: string | null | undefined;
}

const itemContent = (input: ItemContent) => ({
  title: normalizeListItemTitle(input.title),
  quantity: normalizeListItemQuantity(input.quantity),
  unit: normalizeListItemUnit(input.unit),
});

/** The Lists of the Workspace (`list.view`: every role). */
export async function listLists(deps: ListDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ListSummary[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.view');
  return deps.lists.listForWorkspace(input.workspaceId);
}

export async function getList(deps: ListDeps, input: ListRef): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.view');
  const found = await deps.lists.find(input.workspaceId, input.listId);
  if (found === undefined) throw new ListNotFoundError();
  return found;
}

/** Creates a grocery list (`list.edit`: USER, EDITOR, ADMIN). Audited. */
export async function createList(
  deps: ListDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly title: string },
): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.create(
    { workspaceId: input.workspaceId, kind: 'GROCERY', title: normalizeListTitle(input.title), at: deps.clock.now(), maxLists: MAX_LISTS_PER_WORKSPACE },
    userActor(input.actor),
    edit,
  );
  if (result.status === 'ok') return result.list;
  if (result.status === 'limit_reached') throw new ListLimitReachedError();
  return refuse(result.status);
}

/** Renames a List. `expectedTitle` is the name the caller saw: a rename by someone else meanwhile is a conflict. */
export async function renameList(deps: ListDeps, input: ListRef & { readonly title: string; readonly expectedTitle: string }): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.rename(
    { workspaceId: input.workspaceId, listId: input.listId, title: normalizeListTitle(input.title), expectedTitle: input.expectedTitle, at: deps.clock.now() },
    userActor(input.actor),
    edit,
  );
  return result.status === 'ok' ? result.list : refuse(result.status);
}

/** Deletes a List (soft: it can be restored with its items). Audited. */
export async function deleteList(deps: ListDeps, input: ListRef): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.delete({ workspaceId: input.workspaceId, listId: input.listId, at: deps.clock.now() }, userActor(input.actor), edit);
  return result.status === 'ok' ? result.list : refuse(result.status);
}

export async function restoreList(deps: ListDeps, input: ListRef): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.restore(
    { workspaceId: input.workspaceId, listId: input.listId, at: deps.clock.now(), maxLists: MAX_LISTS_PER_WORKSPACE },
    userActor(input.actor),
    edit,
  );
  if (result.status === 'ok') return result.list;
  if (result.status === 'limit_reached') throw new ListLimitReachedError();
  return refuse(result.status);
}

export async function addListItem(deps: ListDeps, input: ListRef & ItemContent): Promise<{ list: ListWithItems; itemId: ListItemId }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.addItem(
    { workspaceId: input.workspaceId, listId: input.listId, ...itemContent(input), at: deps.clock.now(), maxItems: MAX_ITEMS_PER_LIST },
    userActor(input.actor),
    edit,
  );
  if (result.status === 'ok') return { list: result.list, itemId: result.itemId };
  if (result.status === 'limit_reached') throw new ListItemLimitReachedError();
  return refuse(result.status);
}

/** Changes title, quantity and unit of an item; `expectedRevision` is the item's revision the caller saw. */
export async function updateListItem(deps: ListDeps, input: ItemRef & ItemContent & { readonly expectedRevision: number }): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.updateItem(
    { workspaceId: input.workspaceId, listId: input.listId, itemId: input.itemId, ...itemContent(input), expectedRevision: input.expectedRevision, at: deps.clock.now() },
    userActor(input.actor),
    edit,
  );
  return result.status === 'ok' ? result.list : refuse(result.status);
}

/** Marks an item purchased or to buy again. Idempotent: the state it already has is not a conflict. */
export async function setListItemChecked(deps: ListDeps, input: ItemRef & { readonly checked: boolean }): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.setItemChecked(
    { workspaceId: input.workspaceId, listId: input.listId, itemId: input.itemId, checked: input.checked, at: deps.clock.now() },
    userActor(input.actor),
    edit,
  );
  return result.status === 'ok' ? result.list : refuse(result.status);
}

export async function removeListItem(deps: ListDeps, input: ItemRef): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.removeItem({ workspaceId: input.workspaceId, listId: input.listId, itemId: input.itemId, at: deps.clock.now() }, userActor(input.actor), edit);
  return result.status === 'ok' ? result.list : refuse(result.status);
}

/** Puts a removed item back (Undo). */
export async function restoreListItem(deps: ListDeps, input: ItemRef): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.restoreItem(
    { workspaceId: input.workspaceId, listId: input.listId, itemId: input.itemId, at: deps.clock.now(), maxItems: MAX_ITEMS_PER_LIST },
    userActor(input.actor),
    edit,
  );
  if (result.status === 'ok') return result.list;
  if (result.status === 'limit_reached') throw new ListItemLimitReachedError();
  return refuse(result.status);
}
