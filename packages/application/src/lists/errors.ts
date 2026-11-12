/** Unknown List id, a List of another Workspace, or a deleted List. */
export class ListNotFoundError extends Error {
  constructor() {
    super('List not found');
    this.name = 'ListNotFoundError';
  }
}

/** Unknown item id, an item of another List, or a removed item. */
export class ListItemNotFoundError extends Error {
  constructor() {
    super('List item not found');
    this.name = 'ListItemNotFoundError';
  }
}

/** Someone else changed the List's name or this item in the meantime. */
export class ListConflictError extends Error {
  constructor() {
    super('The List was changed by someone else');
    this.name = 'ListConflictError';
  }
}

export class ListLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its limit of Lists');
    this.name = 'ListLimitReachedError';
  }
}

export class ListItemLimitReachedError extends Error {
  constructor() {
    super('The List has reached its limit of items');
    this.name = 'ListItemLimitReachedError';
  }
}

/**
 * A move or batch removal (36.18) that was refused as a whole; nothing was changed. `itemIds` names
 * the caller's own ids that were not usable (unknown, removed, in another List, or repeated).
 */
export type ListBatchErrorCode =
  | 'same_list'
  | 'invalid_items'
  | 'duplicate_item_ids'
  | 'stale_revision'
  | 'operation_reused'
  | 'limit_reached'
  | 'kind_mismatch'
  | 'invalid_operation_id';

export class ListBatchError extends Error {
  readonly code: ListBatchErrorCode;
  readonly itemIds: readonly string[];
  constructor(code: ListBatchErrorCode, itemIds: readonly string[] = []) {
    super(`List items not changed (${code})`);
    this.name = 'ListBatchError';
    this.code = code;
    this.itemIds = itemIds;
  }
}
