/**
 * Removing an account's device data on sign-out (8.5, hardened in 13.1). Deleting an IndexedDB
 * database can be *blocked* by a connection in another tab and then only happens once that tab lets
 * go — so a blocked deletion is never reported as done. Instead:
 *
 * 1. other VMN tabs are told first (they close their connections and leave the account);
 * 2. every VMN store is emptied in one transaction — the data is gone even if the file stays;
 * 3. the database itself is deleted, waiting a bounded time for other tabs to release it.
 *
 * The result says honestly what happened, so the UI can warn when data may remain.
 */
export type CleanupResult =
  /** The database is deleted (or IndexedDB is not available, so nothing was stored). */
  | 'deleted'
  /** All VMN data is removed; an empty database remains because another tab still held it. */
  | 'emptied'
  /** Neither worked: account data may still be on this device. */
  | 'failed';

export type DeleteOutcome = 'deleted' | 'blocked' | 'failed';

export interface CleanupIo {
  /** Tells other tabs of this app that the account signed out. Must not throw. */
  readonly announce: () => void;
  /** Empties every VMN store; true when the transaction committed. */
  readonly emptyStores: () => Promise<boolean>;
  /** Deletes the database; `blocked` when it did not finish within the time limit. */
  readonly deleteDatabase: () => Promise<DeleteOutcome>;
}

export async function cleanUpDevice(io: CleanupIo): Promise<CleanupResult> {
  io.announce();
  const emptied = await io.emptyStores().catch(() => false);
  const deletion = await io.deleteDatabase().catch((): DeleteOutcome => 'failed');
  if (deletion === 'deleted') return 'deleted';
  return emptied ? 'emptied' : 'failed';
}

/**
 * Deletes a database, resolving `deleted` only on real success. `onblocked` is not success: the
 * request stays pending until other connections close; after `timeoutMs` it resolves `blocked`
 * (the deletion may still finish later on its own).
 */
export function deleteIndexedDb(factory: IDBFactory, name: string, timeoutMs: number): Promise<DeleteOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: DeleteOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => settle('blocked'), timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(name);
    } catch {
      settle('failed');
      return;
    }
    request.onsuccess = () => settle('deleted');
    request.onerror = () => settle('failed');
    // onblocked: keep waiting for onsuccess (other tabs were asked to close their connections).
  });
}
