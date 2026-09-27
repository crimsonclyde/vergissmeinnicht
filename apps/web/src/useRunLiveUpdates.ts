import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'off';

/** A change someone made, as announced by the server. The Run itself is always refetched. */
export interface AnnouncedChange {
  readonly revision: number;
  readonly kind: 'STEP_STATE_CHANGED' | 'RUN_COMPLETED' | 'RUN_ABORTED';
  readonly stepId: string | null;
  readonly by: string;
  readonly at: string;
}

export interface LiveHandlers {
  /** The server's current revision (`change` is `null` for the greeting after (re)connecting). */
  readonly onRevision: (revision: number, change: AnnouncedChange | null) => void;
  /** The stream ended for good (Run finished, access lost, limits): refetch once. */
  readonly onClosed: () => void;
}

function parse<T>(event: Event): T | undefined {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return undefined;
  }
}

/**
 * Subscribes to the Run's Server-Sent Events while `url` is set (Step 6.1). Events only say that
 * the Run reached a new revision; the caller refetches canonical state. EventSource reconnects on
 * its own; every (re)connect starts with the current revision, so missed changes are noticed.
 */
export function useRunLiveUpdates(url: string | null, handlers: LiveHandlers): LiveStatus {
  // Status reported by the connection for `url`; a new URL starts as 'connecting'.
  const [reported, setReported] = useState<{ url: string; status: LiveStatus } | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (url === null || typeof EventSource === 'undefined') return;
    const setStatus = (status: LiveStatus) => setReported({ url, status });
    const source = new EventSource(url);
    source.addEventListener('open', () => setStatus('live'));
    source.addEventListener('ready', (event) => {
      const data = parse<{ revision: number }>(event);
      if (data !== undefined) handlersRef.current.onRevision(data.revision, null);
    });
    source.addEventListener('run', (event) => {
      const change = parse<AnnouncedChange>(event);
      if (change === undefined) return;
      handlersRef.current.onRevision(change.revision, change);
      // A finished Run cannot change any more; do not let EventSource reconnect.
      if (change.kind !== 'STEP_STATE_CHANGED') {
        source.close();
        setStatus('off');
      }
    });
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setStatus('off');
        handlersRef.current.onClosed();
      } else {
        setStatus('reconnecting');
      }
    });
    return () => source.close();
  }, [url]);

  if (url === null || typeof EventSource === 'undefined') return 'off';
  return reported?.url === url ? reported.status : 'connecting';
}
