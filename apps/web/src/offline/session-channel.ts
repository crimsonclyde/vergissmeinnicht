/**
 * Coordination between open VMN tabs of one browser (13.1). All tabs share the session cookie and
 * the device database, so when one tab signs out or another account signs in, every other tab must
 * drop the previous account at once: stop sending its queued changes, close its database
 * connections (so the deletion is not blocked) and show the sign-in page.
 *
 * Messages carry no secrets — only what happened and, for a sign-in, the new account's id.
 */
export type SessionMessage = { readonly type: 'signed-out' } | { readonly type: 'signed-in'; readonly userId: string };

const CHANNEL = 'vmn-session';
/**
 * Identifies this tab. A BroadcastChannel delivers a message to every *other channel object* — also
 * to those of the sending tab — so a tab must recognise and ignore its own announcements.
 */
const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

/** The message, unless it is malformed or was sent by the tab `ownTab`. */
export function parseSessionMessage(data: unknown, ownTab: string = TAB_ID): SessionMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { type, userId, tab } = data as { type?: unknown; userId?: unknown; tab?: unknown };
  if (tab === ownTab) return undefined;
  if (type === 'signed-out') return { type };
  if (type === 'signed-in' && typeof userId === 'string') return { type, userId };
  return undefined;
}

/** What a tab showing `currentUserId` must do after a message from another tab. */
export function reactionTo(message: SessionMessage, currentUserId: string | undefined): 'leave' | 'recheck' | 'none' {
  if (message.type === 'signed-out') return currentUserId === undefined ? 'none' : 'leave';
  return message.userId === currentUserId ? 'none' : 'recheck';
}

export function announceSession(message: SessionMessage): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ ...message, tab: TAB_ID });
    channel.close();
  } catch {
    // Not available (old browser, some private modes): tabs then notice on their next request.
  }
}

/** Listens for other tabs' session changes; returns the unsubscribe function. */
export function onSessionMessage(listener: (message: SessionMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    return () => undefined;
  }
  channel.onmessage = (event: MessageEvent) => {
    const message = parseSessionMessage(event.data);
    if (message !== undefined) listener(message);
  };
  return () => channel.close();
}
