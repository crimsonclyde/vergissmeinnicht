import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, messageFor } from '../api.ts';
import { t } from '../i18n/index.ts';
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
  readonly reportUnreachable: () => void;
  readonly reportReachable: () => void;
  readonly dismissNotices: () => void;
}

const OfflineContext = createContext<OfflineValue | null>(null);

export function useOffline(): OfflineValue {
  const value = useContext(OfflineContext);
  if (value === null) throw new Error('useOffline outside OfflineProvider');
  return value;
}

/**
 * Offline execution of active Runs (Step 8.5): keeps the signed-in user's queued Step changes and
 * sends them — strictly in order, each once — when the server is reachable again. The server still
 * decides: a change it refuses is dropped and explained, never retried as something else.
 */
export function OfflineProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [browserOnline, setBrowserOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [unreachable, setUnreachable] = useState(false);
  const [queued, setQueued] = useState<readonly QueuedChange[]>([]);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [notices, setNotices] = useState<readonly string[]>([]);
  const [sentVersion, setSentVersion] = useState(0);
  const sending = useRef(false);

  const reload = useCallback(async () => setQueued(await offlineStore.queued(userId)), [userId]);

  const send = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      let pending = await offlineStore.queued(userId);
      if (pending.length === 0) return;
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
        if (outcome === 'retry') {
          setUnreachable(true);
          break;
        }
        if (outcome === 'sign-in') {
          setNeedsSignIn(true);
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
    } finally {
      sending.current = false;
      await reload();
    }
  }, [userId, reload]);

  // Load this user's queue, then send whenever the browser comes back online and periodically while
  // anything waits.
  useEffect(() => {
    void offlineStore.queued(userId).then((list) => {
      setQueued(list);
      void send();
    });
    const goOnline = () => {
      setBrowserOnline(true);
      setUnreachable(false);
      void send();
    };
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [userId, send]);

  const waiting = queued.length > 0;
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
      reportUnreachable,
      reportReachable,
      dismissNotices,
    }),
    [userId, browserOnline, unreachable, queued, needsSignIn, notices, sentVersion, enqueue, reportUnreachable, reportReachable, dismissNotices],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/** Status line for the whole app: offline, changes waiting, sign in again, refused changes. */
export function OfflineBanner() {
  const offline = useOffline();
  const count = offline.queued.length;
  const text = offline.needsSignIn
    ? t('offline.signInAgain', { count })
    : !offline.online
      ? count > 0
        ? t('offline.offlineWaiting', { count })
        : t('offline.offline')
      : count > 0
        ? t('offline.sending', { count })
        : null;
  return (
    <>
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
