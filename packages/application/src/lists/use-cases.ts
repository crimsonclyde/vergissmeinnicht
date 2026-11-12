import {
  LIST_CHANGE_KEEP_MS,
  MAX_ITEMS_PER_LIST,
  MAX_LIST_BATCH_ITEMS,
  UUID_V4,
  MAX_LISTS_PER_WORKSPACE,
  offlineChangeTime,
  parseListId,
  parseListItemId,
  normalizeListItemQuantity,
  normalizeListItemTitle,
  normalizeListItemUnit,
  normalizeListTitle,
  type ListChange,
  type ListAppearance,
  type ListId,
  type ListItemId,
  type ListKind,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { ListBatchReceipt, ListBatchResult, ListItemEdit, RemovedListItem, ListReplayResult, ListRepository, ListSummary, ListWithItems } from '../ports/list-repository.ts';
import { OfflineAccountMismatchError } from '../runs/errors.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { AttachmentError } from '../attachments/index.ts';
import { ListBatchError, ListConflictError, ListItemLimitReachedError, ListItemNotFoundError, ListLimitReachedError, ListNotFoundError } from './errors.ts';

export interface ListDeps {
  readonly workspaces: WorkspaceRepository;
  readonly lists: ListRepository;
  readonly clock: Clock;
}

/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const edit: ActorGuard = { tool: 'LISTS', actorMay: (role) => roleHasCapability(role, 'list.edit') };

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

export async function authorizeListAppearance(deps: ListDeps, input: ListRef) {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  if (!(await deps.lists.find(input.workspaceId, input.listId))) throw new ListNotFoundError();
}

export async function changeListAppearance(deps: ListDeps, input: ListRef & { expectedRevision: number; appearance: Partial<ListAppearance> }) {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.changeAppearance({ ...input, at: deps.clock.now() }, userActor(input.actor), edit);
  if (result.status === 'ok') return result.list;
  if (result.status === 'cover_not_found') throw new AttachmentError('attachment_not_found');
  return refuse(result.status);
}

export async function findListCover(deps: ListDeps, input: ListRef & { attachmentId: string }) {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.view');
  return deps.lists.findCover(input.workspaceId, input.listId, input.attachmentId, userActor(input.actor),
    { tool: 'LISTS', actorMay: role => roleHasCapability(role, 'list.view') });
}

/** Creates a Shopping or To-do List (`list.edit`: USER, EDITOR, ADMIN). Audited. */
export async function createList(
  deps: ListDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly title: string; readonly kind?: ListKind | undefined },
): Promise<ListWithItems> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const result = await deps.lists.create(
    { workspaceId: input.workspaceId, kind: input.kind ?? 'GROCERY', title: normalizeListTitle(input.title), at: deps.clock.now(), maxLists: MAX_LISTS_PER_WORKSPACE },
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

/** Every List of the Workspace with its items, for a device to keep for offline use (17.5; `list.view`, guests too). */
export async function listSnapshot(deps: ListDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<ListWithItems[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.view');
  return deps.lists.snapshot(input.workspaceId);
}

/** A change as a device sends it: ids and text not yet checked. */
export type RawListChange =
  | { readonly kind: 'createList'; readonly listId: string; readonly title: string; readonly listKind?: ListKind | undefined }
  | { readonly kind: 'renameList'; readonly listId: string; readonly title: string }
  | { readonly kind: 'deleteList'; readonly listId: string }
  | ({ readonly kind: 'addItem' | 'editItem'; readonly listId: string; readonly itemId: string } & ItemContent)
  | { readonly kind: 'checkItem'; readonly listId: string; readonly itemId: string; readonly checked: boolean }
  | { readonly kind: 'removeItem'; readonly listId: string; readonly itemId: string };

/** Ids parsed and text normalized exactly as for the same change made online. */
function normalizeChange(raw: RawListChange): ListChange {
  const listId = parseListId(raw.listId);
  switch (raw.kind) {
    case 'createList':
      return { kind: raw.kind, listId, title: normalizeListTitle(raw.title), listKind: raw.listKind ?? 'GROCERY' };
    case 'renameList':
      return { kind: raw.kind, listId, title: normalizeListTitle(raw.title) };
    case 'deleteList':
      return { kind: raw.kind, listId };
    case 'addItem':
    case 'editItem':
      return { kind: raw.kind, listId, itemId: parseListItemId(raw.itemId), ...itemContent(raw) };
    case 'checkItem':
      return { kind: raw.kind, listId, itemId: parseListItemId(raw.itemId), checked: raw.checked };
    case 'removeItem':
      return { kind: raw.kind, listId, itemId: parseListItemId(raw.itemId) };
  }
}

/**
 * Applies a List change a device made offline (17.5) — sent once, or again after a lost answer:
 * the same change id gets the same answer and is never applied twice. Authorized exactly like the
 * same change made online today (membership, `list.edit`, Lists switched on — re-checked in the
 * transaction); a change made by another account than the one signed in is refused before anything
 * is written. The device's time decides "the later change wins", capped by `offlineChangeTime`.
 */
export async function replayListChange(
  deps: ListDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly clientChangeId: string; readonly madeBy: string; readonly deviceTime: Date; readonly change: RawListChange },
): Promise<Extract<ListReplayResult, { status: 'done' }>> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  if (input.madeBy !== input.actor.id) throw new OfflineAccountMismatchError();
  const change = normalizeChange(input.change);
  const now = deps.clock.now();
  const result = await deps.lists.replay(
    {
      workspaceId: input.workspaceId,
      clientChangeId: input.clientChangeId,
      change,
      madeAt: offlineChangeTime(input.deviceTime, now),
      at: now,
      maxLists: MAX_LISTS_PER_WORKSPACE,
      maxItems: MAX_ITEMS_PER_LIST,
      keepSince: new Date(now.getTime() - LIST_CHANGE_KEEP_MS),
    },
    userActor(input.actor),
    edit,
  );
  if (result.status === 'forbidden') throw new NotAuthorizedError();
  if (result.status === 'id_taken') throw new ListConflictError();
  return result;
}

/** What a move or batch removal answers (36.18): the items it changed and the List revisions after it. */
export interface ListBatchOutcome extends ListBatchReceipt {
  /** The operation id had been used for exactly this request before: nothing was done again. */
  readonly duplicate: boolean;
}

/** A non-empty, bounded selection of distinct item ids; otherwise nothing is touched. */
function batchItemIds(itemIds: readonly string[]): ListItemId[] {
  if (itemIds.length === 0 || itemIds.length > MAX_LIST_BATCH_ITEMS) throw new ListBatchError('invalid_items');
  const malformed = itemIds.filter((id) => !UUID_V4.test(id));
  if (malformed.length > 0) throw new ListBatchError('invalid_items');
  const seen = new Set<string>();
  const repeated = itemIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (repeated.length > 0) throw new ListBatchError('duplicate_item_ids', [...new Set(repeated)]);
  return itemIds as ListItemId[];
}

function batchOutcome(result: ListBatchResult): ListBatchOutcome {
  switch (result.status) {
    case 'ok':
      return { duplicate: result.duplicate, itemIds: result.itemIds, revisions: result.revisions };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'list_not_found':
      throw new ListNotFoundError();
    case 'invalid_items':
      throw new ListBatchError('invalid_items', result.itemIds);
    default:
      throw new ListBatchError(result.status);
  }
}

const batchOperationId = (operationId: string) => {
  if (!UUID_V4.test(operationId)) throw new ListBatchError('invalid_operation_id');
  return operationId;
};

/**
 * Moves items from one List to another List of the same Workspace in one transaction (36.18). Both
 * Lists must still be at the revisions the caller reviewed. The items keep their ids and everything
 * about them; they are appended to the destination in their source order. `list.edit` is required
 * (re-checked in the transaction); a retry with the same operation id and request repeats the first
 * answer, and the same id with a different request is refused.
 */
export async function moveListItems(
  deps: ListDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly sourceListId: string;
    readonly destinationListId: string;
    readonly itemIds: readonly string[];
    readonly operationId: string;
    readonly expectedSourceRevision: number;
    readonly expectedDestinationRevision: number;
  },
): Promise<ListBatchOutcome> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const sourceListId = parseListId(input.sourceListId);
  const destinationListId = parseListId(input.destinationListId);
  if (sourceListId === destinationListId) throw new ListBatchError('same_list');
  const itemIds = batchItemIds(input.itemIds);
  const now = deps.clock.now();
  const result = await deps.lists.moveItems(
    {
      workspaceId: input.workspaceId,
      operationId: batchOperationId(input.operationId),
      sourceListId,
      destinationListId,
      itemIds,
      expectedSourceRevision: input.expectedSourceRevision,
      expectedDestinationRevision: input.expectedDestinationRevision,
      at: now,
      keepSince: new Date(now.getTime() - LIST_CHANGE_KEEP_MS),
      maxItems: MAX_ITEMS_PER_LIST,
    },
    userActor(input.actor),
    edit,
  );
  return batchOutcome(result);
}

/**
 * Removes several items of one List at once (36.18): checked or not, all or none. Removal is the
 * same soft delete as removing one item in the app, so each item can still be put back. The List
 * must be at the reviewed revision; retries behave as for `moveListItems`.
 */
export async function removeListItems(
  deps: ListDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly listId: string;
    readonly itemIds: readonly string[];
    readonly operationId: string;
    readonly expectedRevision: number;
  },
): Promise<ListBatchOutcome> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const listId = parseListId(input.listId);
  const itemIds = batchItemIds(input.itemIds);
  const now = deps.clock.now();
  const result = await deps.lists.removeItems(
    {
      workspaceId: input.workspaceId,
      operationId: batchOperationId(input.operationId),
      listId,
      itemIds,
      expectedRevision: input.expectedRevision,
      at: now,
      keepSince: new Date(now.getTime() - LIST_CHANGE_KEEP_MS),
    },
    userActor(input.actor),
    edit,
  );
  return batchOutcome(result);
}

/** A batch edit as a caller sends it (36.19): any of title, quantity, unit and checked per item. */
export interface ListItemEditRequest {
  readonly itemId: string;
  readonly title?: string | undefined;
  readonly quantity?: string | null | undefined;
  readonly unit?: string | null | undefined;
  readonly checked?: boolean | undefined;
}

/**
 * Edits several items of one List at once (36.19): rename, change quantity or unit, tick or untick —
 * all or none, at the List revision the caller reviewed. Text is normalized exactly as in the app.
 * Retries behave as for `moveListItems`.
 */
export async function updateListItems(
  deps: ListDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly listId: string;
    readonly edits: readonly ListItemEditRequest[];
    readonly operationId: string;
    readonly expectedRevision: number;
  },
): Promise<ListBatchOutcome> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const listId = parseListId(input.listId);
  const itemIds = batchItemIds(input.edits.map((edit) => edit.itemId));
  const edits: ListItemEdit[] = input.edits.map((edit) => {
    if (edit.title === undefined && edit.quantity === undefined && edit.unit === undefined && edit.checked === undefined) {
      throw new ListBatchError('empty_edit', [edit.itemId]);
    }
    return {
      itemId: edit.itemId as ListItemId,
      ...(edit.title === undefined ? {} : { title: normalizeListItemTitle(edit.title) }),
      ...(edit.quantity === undefined ? {} : { quantity: normalizeListItemQuantity(edit.quantity) }),
      ...(edit.unit === undefined ? {} : { unit: normalizeListItemUnit(edit.unit) }),
      ...(edit.checked === undefined ? {} : { checked: edit.checked }),
    };
  });
  const now = deps.clock.now();
  const result = await deps.lists.updateItems(
    {
      workspaceId: input.workspaceId,
      operationId: batchOperationId(input.operationId),
      listId,
      itemIds,
      edits,
      expectedRevision: input.expectedRevision,
      at: now,
      keepSince: new Date(now.getTime() - LIST_CHANGE_KEEP_MS),
    },
    userActor(input.actor),
    edit,
  );
  return batchOutcome(result);
}

/**
 * Puts several removed items of one List back at once (36.19), at their old places — all or none,
 * at the reviewed List revision. Retries behave as for `moveListItems`.
 */
export async function restoreListItems(
  deps: ListDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly listId: string;
    readonly itemIds: readonly string[];
    readonly operationId: string;
    readonly expectedRevision: number;
  },
): Promise<ListBatchOutcome> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const listId = parseListId(input.listId);
  const itemIds = batchItemIds(input.itemIds);
  const now = deps.clock.now();
  const result = await deps.lists.restoreItems(
    {
      workspaceId: input.workspaceId,
      operationId: batchOperationId(input.operationId),
      listId,
      itemIds,
      expectedRevision: input.expectedRevision,
      at: now,
      keepSince: new Date(now.getTime() - LIST_CHANGE_KEEP_MS),
      maxItems: MAX_ITEMS_PER_LIST,
    },
    userActor(input.actor),
    edit,
  );
  return batchOutcome(result);
}

/** How many removed items "Recently deleted" shows. */
export const REMOVED_LIST_ITEMS_SHOWN = 100;

/**
 * The removed items of a List that can still be put back, most recent first (36.19). Only people
 * who may put them back (`list.edit`) see them.
 */
export async function listRemovedListItems(deps: ListDeps, input: ListRef): Promise<RemovedListItem[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'list.edit');
  const found = await deps.lists.removedItems(input.workspaceId, input.listId, REMOVED_LIST_ITEMS_SHOWN);
  if (found === undefined) throw new ListNotFoundError();
  return found;
}
