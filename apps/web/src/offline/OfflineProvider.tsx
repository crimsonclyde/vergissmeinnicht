import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, isNetworkError, messageFor, type ListChangeInput, type ListReplayAnswer } from '../api.ts';
import { t } from '../i18n/index.ts';
import { UPDATE_CHECK_MS, UPDATE_CHECK_URL, isNewerShell, runningScript, updateAction } from './app-update.ts';
import { droppedNotice, followers, listSendOutcome, noticeFor, refusedReason, refusedText, type QueuedListChange, type RefusedReason } from './list-queue.ts';
import { dependents, outcomeOf, type QueuedChange } from './queue.ts';
import { offlineStore } from './store.ts';

/** How often queued changes are retried while any are waiting. */
const RETRY_MS = 30_000;

type NewChange = Omit<QueuedChange, 'clientChangeId' | 'userId' | 'deviceTime' | 'seq'>;

interface OfflineValue {
  readonly userId: string;
  /** False after the browser reports offline or a request could not reach the server. */
  readonly online: boolean;
  /** This user's changes waiting to be sent, in order. */
  readonly queued: readonly QueuedChange[];
  /** The session ended while changes were waiting: sign in again (as the same account) to send them. */
  readonly needsSignIn: boolean;
  /** Changes the server refused, explained (e.g. someone else changed the Step meanwhile). */
  readonly notices: readonly string[];
  /** Increases after queued changes were sent, so views can refetch the canonical state. */
  readonly sentVersion: number;
  readonly enqueue: (change: NewChange) => Promise<boolean>;
  /** This user's List changes kept on this device (17.5), in order — also those refused for good. */
  readonly listChanges: readonly QueuedListChange[];
  /** Increases whenever the Lists kept on this device changed (received, or changes sent). */
  readonly listsVersion: number;
  /** Keeps a List change on this device and sends it as soon as the server is reachable; its id, or null when it could not be kept. */
  readonly enqueueList: (workspaceId: string, change: ListChangeInput, label: string) => Promise<string | null>;
  /** Removes List changes from this device without sending them (Undo before sending, Discard). */
  readonly removeListChanges: (clientChangeIds: readonly string[]) => Promise<void>;
  /** Receives every List of the Workspace for this device (17.5); forgets them when access or the tool is gone. */
  readonly syncLists: (workspaceId: string) => Promise<void>;
  readonly reportUnreachable: () => void;
  readonly reportReachable: () => void;
  readonly dismissNotices: () => void;
}

const OfflineContext = createContext<OfflineValue | null>(null);

/**
 * Runs `send` only if no other tab of this browser is sending (Web Locks); without the API, it just
 * runs — the server answers a change sent twice with its first answer anyway.
 */
async function withSendLock(send: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks === undefined) return send();
  await locks.request('vmn-offline-send', { ifAvailable: true }, async (lock) => {
    if (lock !== null) await send();
  });
}

/**
 * Asks the browser once to keep this site's data (17.5): without it, browsers may delete it when space
 * runs low, and Safari after weeks without use — unsent changes included. Browsers decide on their own
 * (Chrome and Safari silently; Firefox may ask the person).
 */
let persistenceAsked = false;
function askToKeepData(): void {
  if (persistenceAsked || typeof navigator === 'undefined' || navigator.storage?.persist === undefined) return;
  persistenceAsked = true;
  void navigator.storage
    .persisted()
    .then((kept) => (kept ? true : navigator.storage.persist()))
    .catch(() => undefined);
}

export function useOffline(): OfflineValue {
  const value = useContext(OfflineContext);
  if (value === null) throw new Error('useOffline outside OfflineProvider');
  return value;
}

/**
 * Offline execution of active Runs (Step 8.5) and offline Grocery Lists (17.5): keeps the signed-in
 * user's queued Step and List changes and sends them — strictly in order, each once — when the server
 * is reachable again. The server still
 * decides: a change it refuses is dropped and explained, never retried as something else.
 */
export function OfflineProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [browserOnline, setBrowserOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [unreachable, setUnreachable] = useState(false);
  const [queued, setQueued] = useState<readonly QueuedChange[]>([]);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [notices, setNotices] = useState<readonly string[]>([]);
  const [sentVersion, setSentVersion] = useState(0);
  const [listChanges, setListChanges] = useState<readonly QueuedListChange[]>([]);
  const [listsVersion, setListsVersion] = useState(0);
  const sending = useRef(false);

  const reload = useCallback(async () => {
    setQueued(await offlineStore.queued(userId));
    setListChanges(await offlineStore.listChanges(userId));
  }, [userId]);

  const syncLists = useCallback(
    async (workspaceId: string) => {
      try {
        const snapshot = await api.listSnapshot(workspaceId);
        await offlineStore.saveLists(userId, workspaceId, snapshot.lists, snapshot.at);
        askToKeepData();
      } catch (caught) {
        if (isNetworkError(caught)) {
          setUnreachable(true);
          return;
        }
        // No access any more, or Lists switched off: nothing of them stays on this device.
        if (caught instanceof ApiError && (caught.code === 'tool_not_enabled' || caught.code === 'workspace_not_found')) await offlineStore.deleteLists(userId, workspaceId);
        return;
      }
      setListsVersion((version) => version + 1);
    },
    [userId],
  );

  /**
   * Sends List changes (17.5) strictly in order, each once. The server answers what it did; a change
   * that did not apply as made is explained and removed with those that depended on it. Changes the
   * server refuses because access or the tool is gone stay on this device, marked, never applied.
   * Returns false when sending must stop (offline, signed out).
   */
  const sendListChanges = useCallback(
    async (pending: readonly QueuedListChange[]): Promise<boolean> => {
      let queue = [...pending];
      const touched = new Set<string>();
      try {
        while (queue.length > 0) {
          const entry = queue[0] as QueuedListChange;
          let answer: ListReplayAnswer | undefined;
          let error: unknown;
          try {
            answer = await api.replayListChange(entry.workspaceId, { clientChangeId: entry.clientChangeId, userId: entry.userId, deviceTime: entry.deviceTime, change: entry.change });
          } catch (caught) {
            error = caught;
          }
          const outcome = listSendOutcome(error);
          if (outcome === 'retry') {
            setUnreachable(true);
            return false;
          }
          if (outcome === 'sign-in') {
            setNeedsSignIn(true);
            return false;
          }
          setUnreachable(false);
          setNeedsSignIn(false);
          if (outcome === 'refused') {
            const reason = refusedReason(error);
            const held = queue.filter((other) => other.workspaceId === entry.workspaceId);
            for (const other of held) await offlineStore.putListChange({ ...other, refused: reason });
            if (reason !== 'forbidden') await offlineStore.deleteLists(userId, entry.workspaceId);
            touched.add(entry.workspaceId);
            queue = queue.filter((other) => !held.includes(other));
            continue;
          }
          const gone = [entry, ...followers(queue, entry, answer?.outcome ?? 'dropped')];
          await offlineStore.removeListChanges(gone.map((each) => each.clientChangeId));
          const notice = answer === undefined ? droppedNotice(entry, error) : noticeFor(entry, answer);
          if (notice !== null) setNotices((current) => [...current, notice]);
          if (answer !== undefined) await offlineStore.saveList(userId, entry.workspaceId, entry.change.listId, answer.list);
          touched.add(entry.workspaceId);
          queue = queue.filter((other) => !gone.includes(other));
        }
        return true;
      } finally {
        // What the server has now, including others' changes made meanwhile.
        for (const workspaceId of touched) await syncLists(workspaceId);
        if (touched.size > 0) setListsVersion((version) => version + 1);
      }
    },
    [userId, syncLists],
  );

  const send = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      // One tab at a time (17.5): another VMN tab of this browser that is already sending sends everything.
      await withSendLock(async () => {
        let pending = await offlineStore.queued(userId);
        const listPending = (await offlineStore.listChanges(userId)).filter((change) => change.refused === undefined);
        if (pending.length === 0 && listPending.length === 0) return;
        // Queued changes go out only under the session of the account that made them (13.1): after
        // a sign-out or another account's sign-in in another tab, the shared cookie belongs to
        // someone else — then nothing is sent (the server refuses such changes as well).
        let current: Awaited<ReturnType<typeof api.currentUser>>;
        try {
          current = await api.currentUser();
        } catch {
          setUnreachable(true);
          return;
        }
        if (current === null || current.id !== userId) {
          setNeedsSignIn(true);
          return;
        }
        let sent = false;
        let stopped = false;
        while (pending.length > 0) {
          const change = pending[0] as QueuedChange;
          let error: unknown;
          try {
            await api.changeStepState(
              change.workspaceId,
              change.runId,
              change.stepId,
              {
                expectedState: change.expectedState,
                state: change.to,
                ...(change.reason === undefined ? {} : { reason: change.reason }),
              },
              { clientChangeId: change.clientChangeId, userId: change.userId, deviceTime: change.deviceTime },
            );
          } catch (caught) {
            error = caught;
          }
          const outcome = outcomeOf(error);
          if (outcome === 'tool-disabled') {
            setNotices((current) => current.includes(t('offline.toolDisabled')) ? current : [...current, t('offline.toolDisabled')]);
            break;
          }
          if (outcome === 'retry') {
            setUnreachable(true);
            stopped = true;
            break;
          }
          if (outcome === 'sign-in') {
            setNeedsSignIn(true);
            stopped = true;
            break;
          }
          setUnreachable(false);
          setNeedsSignIn(false);
          sent = true;
          const removed = outcome === 'sent' ? [change] : [change, ...dependents(pending, change)];
          await offlineStore.dequeue(removed.map((entry) => entry.clientChangeId));
          if (outcome === 'rejected') {
            setNotices((current) => [...current, t('offline.rejected', { title: change.stepTitle, reason: messageFor(error) })]);
          }
          pending = pending.filter((entry) => !removed.includes(entry));
        }
        if (sent) setSentVersion((version) => version + 1);
        // List changes (17.5) are independent of Run changes; they wait only while the server is unreachable or the session is gone.
        if (!stopped && listPending.length > 0) await sendListChanges(listPending);
      });
    } finally {
      sending.current = false;
      await reload();
    }
  }, [userId, reload, sendListChanges]);

  // Load this user's queue, then send whenever the browser comes back online and periodically while
  // anything waits.
  useEffect(() => {
    void Promise.all([offlineStore.queued(userId), offlineStore.listChanges(userId)]).then(([runs, lists]) => {
      setQueued(runs);
      setListChanges(lists);
      void send();
    });
    const goOnline = () => {
      setBrowserOnline(true);
      setUnreachable(false);
      void send();
    };
    const goOffline = () => setBrowserOnline(false);
    // A phone resumes a frozen tab without an `online` event (iOS): try again when it is shown.
    const shown = () => {
      if (document.visibilityState === 'visible') void send();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', shown);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [userId, send]);

  const waiting = queued.length > 0 || listChanges.some((change) => change.refused === undefined);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void send(), RETRY_MS);
    return () => clearInterval(timer);
  }, [waiting, send]);

  const enqueue = useCallback(
    async (change: NewChange) => {
      const last = (await offlineStore.queued(userId)).at(-1);
      const stored = await offlineStore.enqueue({
        ...change,
        clientChangeId: crypto.randomUUID(),
        userId,
        deviceTime: new Date().toISOString(),
        seq: (last?.seq ?? 0) + 1,
      });
      await reload();
      return stored;
    },
    [userId, reload],
  );

  const enqueueList = useCallback(
    async (workspaceId: string, change: ListChangeInput, label: string) => {
      const last = (await offlineStore.listChanges(userId)).at(-1);
      const clientChangeId = crypto.randomUUID();
      const stored = await offlineStore.putListChange({
        clientChangeId,
        userId,
        workspaceId,
        change,
        label,
        deviceTime: new Date().toISOString(),
        seq: (last?.seq ?? 0) + 1,
      });
      await reload();
      if (browserOnline) void send();
      return stored ? clientChangeId : null;
    },
    [userId, reload, browserOnline, send],
  );

  const removeListChanges = useCallback(
    async (clientChangeIds: readonly string[]) => {
      await offlineStore.removeListChanges(clientChangeIds);
      await reload();
    },
    [reload],
  );

  const reportUnreachable = useCallback(() => setUnreachable(true), []);
  const reportReachable = useCallback(() => {
    setUnreachable(false);
    if (waiting) void send();
  }, [waiting, send]);
  const dismissNotices = useCallback(() => setNotices([]), []);

  const value = useMemo(
    () => ({
      userId,
      online: browserOnline && !unreachable,
      queued,
      needsSignIn,
      notices,
      sentVersion,
      enqueue,
      listChanges,
      listsVersion,
      enqueueList,
      removeListChanges,
      syncLists,
      reportUnreachable,
      reportReachable,
      dismissNotices,
    }),
    [userId, browserOnline, unreachable, queued, needsSignIn, notices, sentVersion, enqueue, listChanges, listsVersion, enqueueList, removeListChanges, syncLists, reportUnreachable, reportReachable, dismissNotices],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/**
 * List changes kept on this device that the server refused because access or the tool is gone (17.5):
 * shown wherever the person is — the Lists page may not exist any more — never applied, discardable.
 */
function RefusedListChanges(props: { changes: readonly QueuedListChange[]; onDiscard: () => void }) {
  if (props.changes.length === 0) return null;
  const heading = t('lists.offlineRefusedHeading', { count: props.changes.length });
  const reasons = [...new Set(props.changes.map((change) => change.refused).filter((reason): reason is RefusedReason => reason !== undefined))];
  return (
    <div className="card stack offline-notices" role="region" aria-label={heading}>
      <strong>{heading}</strong>
      {reasons.map((reason) => (
        <p key={reason} className="muted" style={{ margin: 0 }}>
          {refusedText(reason)}
        </p>
      ))}
      <ul>
        {props.changes.map((change) => (
          <li key={change.clientChangeId}>{change.label}</li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={props.onDiscard}>
          {t('lists.offlineDiscard')}
        </button>
      </div>
    </div>
  );
}

/**
 * "A new version is available" (17.5). Checked now and then, when the tab is shown again and when it
 * comes online — never reloads by itself. Reload is offered only while nothing waits on this device
 * to be sent (and with a connection, which a reload needs to fetch the new version).
 */
function UpdateNotice(props: { unsent: number; online: boolean }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const running = runningScript();
    if (running === null || available) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      fetch(UPDATE_CHECK_URL, { cache: 'no-store', credentials: 'same-origin' })
        .then((response) => (response.ok ? response.text() : ''))
        .then((html) => {
          if (isNewerShell(running, html)) setAvailable(true);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, UPDATE_CHECK_MS);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [available]);
  if (!available) return null;
  const action = updateAction(props.unsent, props.online);
  return (
    <div role="status" className="card stack update-notice">
      <strong>{t('update.available')}</strong>
      {action.kind === 'send-first' && <p style={{ margin: 0 }}>{t('update.sendFirst', { count: action.count })}</p>}
      {action.kind === 'offline' && <p style={{ margin: 0 }}>{t('update.offline')}</p>}
      {action.kind === 'reload' && (
        <div className="row">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            {t('update.reload')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Status line for the whole app: offline, changes waiting, sign in again, refused changes. */
export function OfflineBanner() {
  const offline = useOffline();
  const count = offline.queued.length + offline.listChanges.filter((change) => change.refused === undefined).length;
  const text = offline.needsSignIn
    ? t('offline.signInAgain', { count })
    : !offline.online
      ? count > 0
        ? t('offline.offlineWaiting', { count })
        : t('offline.offline')
      : count > 0
        ? t('offline.sending', { count })
        : null;
  const refused = offline.listChanges.filter((change) => change.refused !== undefined);
  return (
    <>
      <UpdateNotice unsent={count} online={offline.online} />
      <RefusedListChanges changes={refused} onDiscard={() => void offline.removeListChanges(refused.map((change) => change.clientChangeId))} />
      {text !== null && (
        <p role="status" className="offline-banner">
          {text}
        </p>
      )}
      {offline.notices.length > 0 && (
        <div role="alert" className="card stack offline-notices">
          <ul>
            {offline.notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
          <button type="button" className="quiet" onClick={offline.dismissNotices}>
            {t('offline.dismiss')}
          </button>
        </div>
      )}
    </>
  );
}
