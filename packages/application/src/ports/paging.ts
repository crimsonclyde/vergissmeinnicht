/**
 * One page of a list. `nextCursor` is an opaque id to pass back for the following page, or null on
 * the last page. Cursors are ids of the last returned item and are resolved within the same scope
 * (Workspace, Run, …) as the list, so a foreign id never selects anything.
 */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** The cursor does not name an item of this list. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid page cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Splits a query result fetched with `limit + 1` rows into a page. */
export function toPage<T>(rows: T[], limit: number, idOf: (item: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? idOf(last) : null };
}
