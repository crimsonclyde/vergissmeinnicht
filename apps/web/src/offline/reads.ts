/**
 * Saved copies of reads (48.3): what the server answered to this account's reads of Notes, Reminders,
 * the Calendar, Recipes, Contacts, Documents, Maintenance, Equipment, Places, the Daily Planet, … is
 * kept on the device, and shown while the server cannot be reached. Lists and Runs keep their own,
 * richer copies (17.5, 8.5); the session, the Workspace context, administration, security and
 * credential reads are never kept.
 *
 * The server stays the authority: a saved copy is used only when no answer came (offline, or no
 * answer in time with weak signal), never instead of a refusal. Copies are per account and deleted on
 * sign-out with the rest of the device storage.
 */

/** Reads whose answers may be kept. Everything else (admin, auth, account security, …) is never saved. */
const ALLOWED: readonly RegExp[] = [
  // Workspace tools: one Workspace's data below /workspaces/{id}/…
  /^\/workspaces\/[^/?]+\/[^?]+/,
  // The person's own presentation choices. Never the personal Journal (security.md: private entries are
  // not cached offline).
  /^\/account\/(?:today|preferences|workspace-preferences|progress)(?:\?|$)/,
  /^\/account\/places\//,
  /^\/about$/,
];

/** Inside a Workspace: what has its own offline copy (Lists, Runs) or must never be on a device. */
const DENIED: readonly RegExp[] = [
  /^\/workspaces\/[^/]+\/(?:lists|runs)(?:\/|\?|$)/,
  /^\/workspaces\/[^/]+\/(?:backups|knots|calendar-feed|ai-assistants|text-recognition|storage|tools)(?:\/|\?|$)/,
  /\/export(?:\/|\?|$)/,
  /\/images\/usage(?:\?|$)/,
  /\/attachments\/usage(?:\?|$)/,
  // A Notes draft is recovered only from the server: a stale copy could bring back a discarded draft.
  /\/journal\/draft(?:\?|$)/,
];

/** Searches are not kept: only the plain views are, so a few saved copies cover each app. */
function isSearch(path: string): boolean {
  const query = path.indexOf('?');
  if (query === -1) return false;
  const params = new URLSearchParams(path.slice(query + 1));
  return ['q', 'search'].some((name) => (params.get(name) ?? '').trim() !== '');
}

export function isSavedRead(path: string): boolean {
  return ALLOWED.some((rule) => rule.test(path)) && !DENIED.some((rule) => rule.test(path)) && !isSearch(path);
}

/** The Workspace a read belongs to, if any. */
export function workspaceOfRead(path: string): string | null {
  const match = /^\/workspaces\/([^/?]+)\//.exec(path);
  return match === null ? null : decodeURIComponent(match[1] ?? '');
}

/** After this long without an answer, a saved copy is shown (weak signal); the answer still updates it. */
export const SAVED_READ_AFTER_MS = 6000;

export interface ReadStore {
  readonly save: (userId: string, path: string, body: unknown) => Promise<void>;
  readonly load: (userId: string, path: string) => Promise<{ readonly body: unknown; readonly savedAt: string } | undefined>;
}

export interface ReadEvents {
  /** A saved copy was shown instead of an answer. */
  readonly copyShown: (savedAt: string) => void;
  /** An answer came: the server is reachable. */
  readonly answered: () => void;
}

/**
 * Asks the server; keeps the answer for `userId`; shows the saved copy when no answer comes (an error
 * answer is never replaced by a copy). `isNetworkError` tells "no answer" from "an answer".
 */
export async function readWithCopy<T>(
  userId: string,
  path: string,
  ask: () => Promise<T>,
  store: ReadStore,
  events: ReadEvents,
  isNetworkError: (error: unknown) => boolean,
  waitMs: number = SAVED_READ_AFTER_MS,
): Promise<T> {
  const network = ask().then((body) => {
    events.answered();
    void store.save(userId, path, body);
    return body;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => resolve('slow'), waitMs);
  });
  const copy = async (error?: unknown): Promise<T> => {
    const saved = await store.load(userId, path);
    if (saved === undefined) {
      if (error !== undefined) throw error;
      return network;
    }
    events.copyShown(saved.savedAt);
    return saved.body as T;
  };
  try {
    const first = await Promise.race([network, slow]);
    if (first === 'slow') {
      // The answer may still come; it then only updates the saved copy.
      network.catch(() => undefined);
      return await copy();
    }
    return first;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return copy(error);
  } finally {
    clearTimeout(timer);
  }
}
