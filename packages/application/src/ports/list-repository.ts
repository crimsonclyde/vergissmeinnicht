import type { Actor, List, ListId, ListItem, ListItemId, ListKind, WorkspaceId } from '@vergissmeinnicht/domain';
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
 * Lists are addressed by Workspace id + List id, items by Workspace id + List id + item id: an id of
 * another Workspace or List behaves like an unknown id. Every write happens in one transaction that
 * re-checks the guard, changes the rows and raises the List's revision; List-level changes also
 * record their audit event (LIST_CREATED / _RENAMED / _DELETED / _RESTORED) in it.
 */
export interface ListRepository {
  /** Lists of the Workspace that are not deleted, oldest first. */
  listForWorkspace(workspaceId: WorkspaceId): Promise<ListSummary[]>;
  /** `undefined` for unknown, foreign and deleted Lists. */
  find(workspaceId: WorkspaceId, listId: ListId): Promise<ListWithItems | undefined>;
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
  /** Puts a removed item back at its old place; counts against `maxItems` again. */
  restoreItem(
    input: { readonly workspaceId: WorkspaceId; readonly listId: ListId; readonly itemId: ListItemId; readonly at: Date; readonly maxItems: number },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ListChangeResult<'list_not_found' | 'item_not_found' | 'limit_reached'>>;
}
