import type { RunChange, RunId } from '@vergissmeinnicht/domain';

/** Resource bounds for open subscriptions (docs/development/security.md §7). */
export interface RunChangeHubLimits {
  /** Open subscriptions in the whole process. */
  readonly maxSubscriptions: number;
  /** Open subscriptions per user (several tabs/devices). */
  readonly maxSubscriptionsPerUser: number;
}

export const DEFAULT_RUN_CHANGE_HUB_LIMITS: RunChangeHubLimits = Object.freeze({
  maxSubscriptions: 1000,
  maxSubscriptionsPerUser: 10,
});

export interface RunChangeSubscription {
  unsubscribe(): void;
}

export interface RunChangeHub {
  /**
   * Registers a listener for one Run. Authorization is the caller's job and must happen before
   * subscribing (and again before delivering each change). Returns `undefined` when a limit is reached.
   */
  subscribe(runId: RunId, userId: string, listener: (change: RunChange) => void): RunChangeSubscription | undefined;
  /** Delivers a committed change to the Run's listeners. Never throws. */
  runChanged(change: RunChange): void;
  /** Open subscriptions (for tests and diagnostics). */
  size(): number;
}

interface Entry {
  readonly userId: string;
  readonly listener: (change: RunChange) => void;
}

/**
 * In-process fan-out of Run changes. SSE is never the source of truth: a change only tells
 * subscribers that the Run moved to a new revision; they refetch it through the authorized API.
 * A shared pub/sub can replace this for multi-node deployments without touching the use-cases.
 */
export function createRunChangeHub(limits: RunChangeHubLimits = DEFAULT_RUN_CHANGE_HUB_LIMITS): RunChangeHub {
  const byRun = new Map<RunId, Set<Entry>>();
  const perUser = new Map<string, number>();
  let total = 0;

  return {
    subscribe(runId, userId, listener) {
      const own = perUser.get(userId) ?? 0;
      if (total >= limits.maxSubscriptions || own >= limits.maxSubscriptionsPerUser) return undefined;
      const entry: Entry = { userId, listener };
      const entries = byRun.get(runId) ?? new Set<Entry>();
      entries.add(entry);
      byRun.set(runId, entries);
      perUser.set(userId, own + 1);
      total += 1;

      let active = true;
      return {
        unsubscribe() {
          if (!active) return;
          active = false;
          entries.delete(entry);
          if (entries.size === 0) byRun.delete(runId);
          const remaining = (perUser.get(userId) ?? 1) - 1;
          if (remaining === 0) perUser.delete(userId);
          else perUser.set(userId, remaining);
          total -= 1;
        },
      };
    },

    runChanged(change) {
      // Copy: listeners may unsubscribe while being notified.
      for (const entry of [...(byRun.get(change.runId) ?? [])]) {
        try {
          entry.listener(change);
        } catch {
          // One failing subscriber must not affect the others or the committed write.
        }
      }
    },

    size: () => total,
  };
}
