import type { Actor, AttachmentRecord, List, ListAppearance, ListChange, ListId, ListItem, ListItemId, ListKind, ListReplayOutcome, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

/** A List in the overview: how much is still to buy and how much is checked off. */
export interface ListSummary {
  readonly list: List;
  readonly open: number;
  readonly checked: number;
}

/** A List with its items (removed ones left out), in their order. */
export interface ListWithItems {
  readonly list: List;
  readonly items: readonly ListItem[];
}

type Refusal<Code extends string> = { readonly status: 'forbidden' | Code };
/** Every change answers with the canonical List afterwards, so clients never have to guess. */
export type ListChangeResult<Code extends string = never> = { readonly status: 'ok'; readonly list: ListWithItems } | Refusal<Code>;

type UserActor = Actor & { readonly kind: 'user' };

/**
 * Moving or removing several items at once (36.18). One IMMEDIATE transaction: either every named
 * item is moved/removed and the List revisions rise once, or nothing changes. The operation id is
 * remembered with a hash of the request, so a retry gets the first answer and is never applied twice.
 */
export interface ListBatchCommon {
  readonly workspaceId: WorkspaceId;
  readonly operationId: string;
  readonly itemIds: readonly ListItemId[];
  readonly at: Date;
  /** Remembered operations older than this are forgotten (`LIST_CHANGE_KEEP_MS`). */
  readonly keepSince: Date;
}
export interface ListMoveInput extends ListBatchCommon {
  readonly sourceListId: ListId;
  readonly destinationListId: ListId;
  readonly expectedSourceRevision: number;
  readonly expectedDestinationRevision: number;
  readonly maxItems: number;
}
export interface ListRemoveInput extends ListBatchCommon {
  readonly listId: ListId;
  readonly expectedRevision: number;
}
/**
 * One item change of a batch edit (36.19): any of title, quantity, unit and checked; a field left
 * out stays as it is. Values are already normalized.
 */
export interface ListItemEdit {
  readonly itemId: ListItemId;
  readonly title?: string;
  readonly quantity?: string | null;
  readonly unit?: string | null;
  readonly checked?: boolean;
}
export interface ListUpdateInput extends ListBatchCommon {
  readonly listId: ListId;
  readonly expectedRevision: number;
  /** One per item, in the order of `itemIds`. */
  readonly edits: readonly ListItemEdit[];
}
export interface ListRestoreInput extends ListBatchCommon {
  readonly listId: ListId;
  readonly expectedRevision: number;
  readonly maxItems: number;
}
/** A removed item that can still be put back, with when and by whom it was removed. */
export interface RemovedListItem {
  readonly item: ListItem;
  readonly removedAt: Date;
  readonly removedBy: string | null;
}
/** The List revisions right after the operation, by List id. */
export interface ListBatchReceipt {
  readonly itemIds: readonly ListItemId[];
  readonly revisions: Readonly<Record<string, number>>;
}
export type ListBatchResult =
  | ({ readonly status: 'ok'; readonly duplicate: boolean } & ListBatchReceipt)
  | { readonly status: 'forbidden' | 'list_not_found' | 'stale_revision' | 'operation_reused' | 'limit_reached' | 'kind_mismatch' }
  | { readonly status: 'invalid_items'; readonly itemIds: readonly ListItemId[] };

/** A List change made offline, as the server applies it (17.5): normalized, with the time it counts as made. */
export interface ListReplayInput {
  readonly workspaceId: WorkspaceId;
  readonly clientChangeId: string;
  readonly change: ListChange;
  /** When the change counts as made (`offlineChangeTime`): what "the later change wins" compares. */
  readonly madeAt: Date;
  /** The server's time. */
  readonly at: Date;
  readonly maxLists: number;
  readonly maxItems: number;
  /** Remembered changes older than this are forgotten (`LIST_CHANGE_KEEP_MS`). */
  readonly keepSince: Date;
}

export type ListReplayResult =
  | {
      readonly status: 'done';
      readonly outcome: ListReplayOutcome;
      /** The change had been received before: nothing was done again; the first answer is repeated. */
      readonly duplicate: boolean;
      /** Whose change won and when, for the notice — when it was not this one. */
      readonly by: string | null;
      readonly byAt: Date | null;
      /** The List now, when it exists and is not deleted. */
      readonly list: ListWithItems | null;
    }
  | { readonly status: 'forbidden' }
  /** The client id of a new List or item, or the change id, is already used for something else. */
  | { readonly status: 'id_taken' };

/**
 * Lists are addressed by Workspace id + List id, items by Workspace id + List id + item id: an id of
 * another Workspace or List behaves like an unknown id. Every write happens in one transaction that
 * re-checks the guard, changes the rows and raises the List's revision; List-level changes also
 * record their audit event (LIST_CREATED / _RENAMED / _DELETED / _RESTORED) in it.
 */
export interface ListRepository {
  /** Lists of the Workspace that are not deleted, oldest first. */
  listForWorkspace(workspaceId: WorkspaceId): Promise<ListSummary[]>;
  /** Every List of the Workspace that is not deleted, with its items — what a device keeps for offline use (17.5). */
  snapshot(workspaceId: WorkspaceId): Promise<ListWithItems[]>;
  /**
   * Applies one change made offline (17.5) in one IMMEDIATE transaction: re-checks the guard, answers
   * a change id it has seen before with the first answer (nothing is applied twice), applies the
   * merge rules of `ListChange`, records List-level audit events and remembers the outcome.
   */
  replay(input: ListReplayInput, actor: UserActor, guard: ActorGuard): Promise<ListReplayResult>;
  /** `undefined` for unknown, foreign and deleted Lists. */
  find(workspaceId: WorkspaceId, listId: ListId): Promise<ListWithItems | undefined>;
  findCover(workspaceId: WorkspaceId, listId: ListId, attachmentId: string, actor: UserActor, guard: ActorGuard): Promise<AttachmentRecord | undefined>;
  changeAppearance(
    input: { workspaceId: WorkspaceId; listId: ListId; expectedRevision: number; appearance: Partial<ListAppearance>; at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'conflict' | 'cover_not_found'>>;
  create(
    input: { readonly workspaceId: WorkspaceId; readonly kind: ListKind; readonly title: string; readonly at: Date; readonly maxLists: number },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'limit_reached'>>;
  /** Compare-and-set on the title: refuses with `conflict` when someone else renamed it meanwhile. */
  rename(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly title: string; readonly expectedTitle: string; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'conflict'>>;
  /** Soft delete. The List keeps its items and can be restored. */
  delete(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found'>>;
  /** Only finds deleted Lists; counts against `maxLists` again. */
  restore(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly at: Date; readonly maxLists: number },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'limit_reached'>>;
  /** Appends the item at the end of the List. */
  addItem(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly listId: ListId;
      readonly title: string;
      readonly quantity: string | null;
      readonly unit: string | null;
      readonly at: Date;
      readonly maxItems: number;
    },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<{ readonly status: 'ok'; readonly list: ListWithItems; readonly itemId: ListItemId } | Refusal<'list_not_found' | 'limit_reached'>>;
  /** Compare-and-set on the item's revision. */
  updateItem(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly listId: ListId;
      readonly itemId: ListItemId;
      readonly title: string;
      readonly quantity: string | null;
      readonly unit: string | null;
      readonly expectedRevision: number;
      readonly at: Date;
    },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'item_not_found' | 'conflict'>>;
  /**
   * Checks or unchecks an item. Asking for the state it already has changes nothing (two people
   * ticking the same item is not a conflict; the first one stays recorded).
   */
  setItemChecked(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly itemId: ListItemId; readonly checked: boolean; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'item_not_found'>>;
  /** Removes an item (soft delete); removing a removed item is `item_not_found`. */
  removeItem(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly itemId: ListItemId; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'item_not_found'>>;
  /**
   * Moves live items of one List to the end of another List of the same Workspace and kind (36.18).
   * The items keep their ids, text, quantity, unit, checked state and who added/checked them.
   */
  moveItems(input: ListMoveInput, actor: UserActor, guard: ActorGuard): Promise<ListBatchResult>;
  /** Removes several live items (soft delete, like `removeItem`, so each can be put back). */
  removeItems(input: ListRemoveInput, actor: UserActor, guard: ActorGuard): Promise<ListBatchResult>;
  /**
   * Edits several live items of one List at once (36.19): text, quantity, unit and checked state, all
   * or none. Content edits raise the item's revision; asking for the checked state an item already
   * has changes nothing for it.
   */
  updateItems(input: ListUpdateInput, actor: UserActor, guard: ActorGuard): Promise<ListBatchResult>;
  /** Puts several removed items back at their old places (36.19); counts against `maxItems` again. */
  restoreItems(input: ListRestoreInput, actor: UserActor, guard: ActorGuard): Promise<ListBatchResult>;
  /** Removed items of a live List, most recently removed first (36.19); `undefined` for an unknown List. */
  removedItems(workspaceId: WorkspaceId, listId: ListId, limit: number): Promise<RemovedListItem[] | undefined>;
  /** Puts a removed item back at its old place; counts against `maxItems` again. */
  restoreItem(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly itemId: ListItemId; readonly at: Date; readonly maxItems: number },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'item_not_found' | 'limit_reached'>>;
}
