import type { CurrentUser, ListDetail, RunDetail, WorkspaceSummary } from '../api.ts';
import { cleanUpDevice, deleteIndexedDb, type CleanupResult } from './cleanup.ts';
import type { QueuedListChange } from './list-queue.ts';
import type { QueuedChange } from './queue.ts';
import { announceSession } from './session-channel.ts';

/**
 * Device storage for offline Runs (Step 8.5) and Grocery Lists (17.5), in IndexedDB: the active Runs
 * this user opened while online, every List of the Workspaces they opened, and the user's queued
 * Step and List changes. Everything is keyed by user id, deleted on sign-out
 * and when another account signs in on this browser. Workspace-confidential data lives here only
 * while it is needed; storage may be unavailable (private mode) — then offline use is simply off.
 */
const DB_NAME = 'vmn-offline';
const RUNS = 'runs';
const QUEUE = 'queue';
/** The signed-in user and Workspace contexts, so a reload while offline still shows saved Runs. */
const CONTEXT = 'context';
/** Instruction images of saved Runs (14.3), so a Run's photos are there offline too. */
const IMAGES = 'images';
/** Every List of a Workspace with its items, as last received (17.5): one entry per account and Workspace. */
const LISTS = 'lists';
/** List changes made on this device and not answered yet (17.5). */
const LIST_QUEUE = 'list-queue';
const STORES = [RUNS, QUEUE, CONTEXT, IMAGES, LISTS, LIST_QUEUE];
/** How long sign-out waits for other tabs to release the database before reporting `emptied`. */
const DELETE_WAIT_MS = 3000;

/**
 * Set while no account may use the device storage: from sign-out (here or in another tab) until
 * the next account is known. Late writes of a leaving view would otherwise re-create saved data.
 */
let suspended = false;

interface ContextEntry {
  readonly key: string;
  readonly userId: string;
  readonly value: unknown;
}

export interface SavedWorkspace {
  readonly workspace: WorkspaceSummary;
  /** UI only: the server authorizes every change when it is sent. */
  readonly capabilities: readonly string[];
}

export interface SavedRun {
  readonly key: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly run: RunDetail;
  readonly savedAt: string;
}

/** The Lists of one Workspace kept on this device, and when the server sent them. */
export interface SavedLists {
  readonly key: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly lists: readonly ListDetail[];
  readonly savedAt: string;
}

const runKey = (userId: string, runId: string) => `${userId}:${runId}`;
const listsKey = (userId: string, workspaceId: string) => `${userId}:${workspaceId}`;
const imageKey = (userId: string, workspaceId: string, imageId: string) => `${userId}:${workspaceId}:${imageId}`;

interface SavedImage {
  readonly key: string;
  readonly userId: string;
  readonly blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Versions only ever add stores: an app update never drops what is waiting on the device (17.5).
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(RUNS, { keyPath: 'key' });
        db.createObjectStore(QUEUE, { keyPath: 'clientChangeId' });
        db.createObjectStore(CONTEXT, { keyPath: 'key' });
      }
      if (event.oldVersion < 2) db.createObjectStore(IMAGES, { keyPath: 'key' });
      if (event.oldVersion < 3) {
        db.createObjectStore(LISTS, { keyPath: 'key' });
        db.createObjectStore(LIST_QUEUE, { keyPath: 'clientChangeId' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deletes the database (sign-out): let go at once instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(name, mode);
      const request = action(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** Never throws: device storage is a convenience, the server stays authoritative. */
async function safely<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (typeof indexedDB === 'undefined' || suspended) return fallback;
    return await action();
  } catch {
    return fallback;
  }
}

export const offlineStore = {
  saveRun: (userId: string, workspaceId: string, run: RunDetail) =>
    safely(async () => {
      const entry: SavedRun = { key: runKey(userId, run.id), userId, workspaceId, run, savedAt: new Date().toISOString() };
      await withStore(RUNS, 'readwrite', (store) => store.put(entry));
    }, undefined),

  deleteRun: (userId: string, runId: string) =>
    safely(async () => {
      await withStore(RUNS, 'readwrite', (store) => store.delete(runKey(userId, runId)));
    }, undefined),

  loadRun: (userId: string, workspaceId: string, runId: string) =>
    safely(async () => {
      const entry = (await withStore<SavedRun | undefined>(RUNS, 'readonly', (store) => store.get(runKey(userId, runId)) as IDBRequest<SavedRun | undefined>)) ?? undefined;
      return entry !== undefined && entry.userId === userId && entry.workspaceId === workspaceId ? entry : undefined;
    }, undefined),

  listRuns: (userId: string, workspaceId: string) =>
    safely(async () => {
      const all = (await withStore<SavedRun[]>(RUNS, 'readonly', (store) => store.getAll() as IDBRequest<SavedRun[]>)) ?? [];
      return all.filter((entry) => entry.userId === userId && entry.workspaceId === workspaceId);
    }, [] as SavedRun[]),

  /** An instruction image of a saved Run; only images are stored here, as served by the server. */
  saveImage: (userId: string, workspaceId: string, imageId: string, blob: Blob) =>
    safely(async () => {
      const entry: SavedImage = { key: imageKey(userId, workspaceId, imageId), userId, blob };
      await withStore(IMAGES, 'readwrite', (store) => store.put(entry));
    }, undefined),

  loadImage: (userId: string, workspaceId: string, imageId: string) =>
    safely(async () => {
      const entry = await withStore<SavedImage | undefined>(IMAGES, 'readonly', (store) => store.get(imageKey(userId, workspaceId, imageId)) as IDBRequest<SavedImage | undefined>);
      return entry?.userId === userId ? entry.blob : undefined;
    }, undefined),

  queued: (userId: string) =>
    safely(async () => {
      const all = (await withStore<QueuedChange[]>(QUEUE, 'readonly', (store) => store.getAll() as IDBRequest<QueuedChange[]>)) ?? [];
      return all.filter((change) => change.userId === userId).sort((a, b) => a.seq - b.seq);
    }, [] as QueuedChange[]),

  enqueue: (change: QueuedChange) =>
    safely(async () => {
      await withStore(QUEUE, 'readwrite', (store) => store.put(change));
      return true;
    }, false),

  dequeue: (clientChangeIds: readonly string[]) =>
    safely(async () => {
      await withStore(QUEUE, 'readwrite', (store) => {
        for (const id of clientChangeIds) store.delete(id);
        return undefined;
      });
    }, undefined),

  /** All Lists of the Workspace as the server just sent them (17.5). */
  saveLists: (userId: string, workspaceId: string, lists: readonly ListDetail[], savedAt: string) =>
    safely(async () => {
      const entry: SavedLists = { key: listsKey(userId, workspaceId), userId, workspaceId, lists, savedAt };
      await withStore(LISTS, 'readwrite', (store) => store.put(entry));
    }, undefined),

  loadLists: (userId: string, workspaceId: string) =>
    safely(async () => {
      const entry = await withStore<SavedLists | undefined>(LISTS, 'readonly', (store) => store.get(listsKey(userId, workspaceId)) as IDBRequest<SavedLists | undefined>);
      return entry !== undefined && entry.userId === userId && entry.workspaceId === workspaceId ? entry : undefined;
    }, undefined),

  /** One List as the server just answered (`null`: it is deleted or gone), in the same transaction as reading the rest. */
  saveList: (userId: string, workspaceId: string, listId: string, list: ListDetail | null) =>
    safely(async () => {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(LISTS, 'readwrite');
          const store = transaction.objectStore(LISTS);
          const read = store.get(listsKey(userId, workspaceId)) as IDBRequest<SavedLists | undefined>;
          read.onsuccess = () => {
            const entry = read.result;
            // Only a Workspace whose Lists were received as a whole is kept; a single List does not start one.
            if (entry === undefined || entry.userId !== userId) return;
            const others = entry.lists.filter((each) => each.id !== listId);
            const at = entry.lists.findIndex((each) => each.id === listId);
            const lists = list === null ? others : at === -1 ? [...others, list] : entry.lists.map((each) => (each.id === listId ? list : each));
            store.put({ ...entry, lists } satisfies SavedLists);
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        });
      } finally {
        db.close();
      }
    }, undefined),

  /** The Workspace's Lists may no longer be kept (no access, Lists switched off). */
  deleteLists: (userId: string, workspaceId: string) =>
    safely(async () => {
      await withStore(LISTS, 'readwrite', (store) => store.delete(listsKey(userId, workspaceId)));
    }, undefined),

  listChanges: (userId: string) =>
    safely(async () => {
      const all = (await withStore<QueuedListChange[]>(LIST_QUEUE, 'readonly', (store) => store.getAll() as IDBRequest<QueuedListChange[]>)) ?? [];
      return all.filter((change) => change.userId === userId).sort((a, b) => a.seq - b.seq);
    }, [] as QueuedListChange[]),

  /** Adds or replaces one List change (e.g. marked as refused). */
  putListChange: (change: QueuedListChange) =>
    safely(async () => {
      await withStore(LIST_QUEUE, 'readwrite', (store) => store.put(change));
      return true;
    }, false),

  removeListChanges: (clientChangeIds: readonly string[]) =>
    safely(async () => {
      await withStore(LIST_QUEUE, 'readwrite', (store) => {
        for (const id of clientChangeIds) store.delete(id);
        return undefined;
      });
    }, undefined),

  saveUser: (user: CurrentUser) =>
    safely(async () => {
      const entry: ContextEntry = { key: 'user', userId: user.id, value: user };
      await withStore(CONTEXT, 'readwrite', (store) => store.put(entry));
    }, undefined),

  /** The last signed-in user of this browser (for a reload while offline). */
  lastUser: () =>
    safely(async () => {
      const entry = await withStore<ContextEntry | undefined>(CONTEXT, 'readonly', (store) => store.get('user') as IDBRequest<ContextEntry | undefined>);
      return entry?.value as CurrentUser | undefined;
    }, undefined),

  /** The person's Today layout as last received (19.2), so Today keeps their cards offline. Deleted on sign-out. */
  saveTodayLayout: (userId: string, layout: unknown) =>
    safely(async () => {
      const entry: ContextEntry = { key: `today-layout:${userId}`, userId, value: layout };
      await withStore(CONTEXT, 'readwrite', (store) => store.put(entry));
    }, undefined),

  loadTodayLayout: (userId: string) =>
    safely(async () => {
      const entry = await withStore<ContextEntry | undefined>(CONTEXT, 'readonly', (store) => store.get(`today-layout:${userId}`) as IDBRequest<ContextEntry | undefined>);
      return entry?.userId === userId ? entry.value : undefined;
    }, undefined),

  saveWorkspaceList: (userId: string, list: readonly WorkspaceSummary[]) =>
    safely(async () => {
      const entry: ContextEntry = { key: `workspaces:${userId}`, userId, value: list };
      await withStore(CONTEXT, 'readwrite', (store) => store.put(entry));
    }, undefined),

  loadWorkspaceList: (userId: string) =>
    safely(async () => {
      const entry = await withStore<ContextEntry | undefined>(CONTEXT, 'readonly', (store) => store.get(`workspaces:${userId}`) as IDBRequest<ContextEntry | undefined>);
      return entry?.userId === userId ? (entry.value as WorkspaceSummary[]) : undefined;
    }, undefined),

  saveWorkspace: (userId: string, saved: SavedWorkspace) =>
    safely(async () => {
      const entry: ContextEntry = { key: `workspace:${userId}:${saved.workspace.id}`, userId, value: saved };
      await withStore(CONTEXT, 'readwrite', (store) => store.put(entry));
    }, undefined),

  loadWorkspace: (userId: string, workspaceId: string) =>
    safely(async () => {
      const entry = await withStore<ContextEntry | undefined>(
        CONTEXT,
        'readonly',
        (store) => store.get(`workspace:${userId}:${workspaceId}`) as IDBRequest<ContextEntry | undefined>,
      );
      return entry?.userId === userId ? (entry.value as SavedWorkspace) : undefined;
    }, undefined),

  /** Keeps only this user's data (another account signed in on this browser). */
  discardOtherUsers: (userId: string) =>
    safely(async () => {
      for (const name of STORES) {
        const all = (await withStore<{ userId: string; key?: string; clientChangeId?: string }[]>(name, 'readonly', (store) => store.getAll())) ?? [];
        const foreign = all.filter((entry) => entry.userId !== userId).map((entry) => entry.key ?? entry.clientChangeId ?? '');
        if (foreign.length > 0) {
          await withStore(name, 'readwrite', (store) => {
            for (const key of foreign) store.delete(key);
            return undefined;
          });
        }
      }
    }, undefined),

  /** Stops all device storage use (signed out here or in another tab) until `resume`. */
  suspend: () => {
    suspended = true;
  },

  /** An account is signed in again: device storage may be used (for that account's entries). */
  resume: () => {
    suspended = false;
  },

  /**
   * Sign-out: nothing of this account stays on the device. Other tabs are told first; every store is
   * emptied, then the database deleted. Resolves how far that got — a deletion blocked by another
   * tab is never reported as done.
   */
  clear: async (): Promise<CleanupResult> => {
    suspended = true;
    if (typeof indexedDB === 'undefined') {
      announceSession({ type: 'signed-out' });
      return 'deleted';
    }
    return cleanUpDevice({
      announce: () => announceSession({ type: 'signed-out' }),
      emptyStores: async () => {
        const db = await open();
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORES, 'readwrite');
            for (const name of STORES) transaction.objectStore(name).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB clear failed'));
            transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB clear aborted'));
          });
          return true;
        } finally {
          db.close();
        }
      },
      deleteDatabase: () => deleteIndexedDb(indexedDB, DB_NAME, DELETE_WAIT_MS),
    });
  },
};
