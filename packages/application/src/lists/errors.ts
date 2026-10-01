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
