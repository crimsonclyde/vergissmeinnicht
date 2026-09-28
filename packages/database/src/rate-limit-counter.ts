import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { rateLimits } from './schema.ts';

export interface RateLimitState {
  /** Hits in the current window, capped at `max + 1` (writes stop once the limit is exceeded). */
  readonly current: number;
  /** Milliseconds until the window ends. */
  readonly ttl: number;
}

/** Keys may contain email addresses or IPs; only a hash is stored. */
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Fixed-window counters persisted in SQLite (Step 2.9): used for the security-sensitive rate limits
 * so a restart does not reset them. Once a key exceeds its limit, further hits are not written, so
 * a flood costs one write per window rather than one per request.
 */
export function createRateLimitCounter({ db }: Pick<AppDatabase, 'db'>) {
  return {
    hit(key: string, windowMs: number, max: number, now = Date.now()): RateLimitState {
      const keyHash = hashKey(key);
      return db.transaction((tx) => {
        const row = tx.select().from(rateLimits).where(eq(rateLimits.keyHash, keyHash)).get();
        const start = row?.windowStart.getTime() ?? 0;
        if (row === undefined || start + row.windowMs <= now) {
          tx.insert(rateLimits)
            .values({ keyHash, hits: 1, windowStart: new Date(now), windowMs })
            .onConflictDoUpdate({ target: rateLimits.keyHash, set: { hits: 1, windowStart: new Date(now), windowMs } })
            .run();
          return { current: 1, ttl: windowMs };
        }
        const ttl = start + row.windowMs - now;
        if (row.hits > max) return { current: row.hits, ttl };
        tx.update(rateLimits).set({ hits: row.hits + 1 }).where(eq(rateLimits.keyHash, keyHash)).run();
        return { current: row.hits + 1, ttl };
      }, IMMEDIATE);
    },

    /** Current state without counting a hit. */
    peek(key: string, now = Date.now()): RateLimitState {
      const row = db.select().from(rateLimits).where(eq(rateLimits.keyHash, hashKey(key))).get();
      if (row === undefined || row.windowStart.getTime() + row.windowMs <= now) return { current: 0, ttl: 0 };
      return { current: row.hits, ttl: row.windowStart.getTime() + row.windowMs - now };
    },
  };
}

export type RateLimitCounter = ReturnType<typeof createRateLimitCounter>;
