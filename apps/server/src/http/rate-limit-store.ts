import { createRequire } from 'node:module';
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { RateLimitCounter } from '@vergissmeinnicht/database';

declare module '@fastify/rate-limit' {
  interface CreateRateLimitOptions {
    /**
     * Name of a persistent counter (Step 2.9): the limit is kept in the database and survives a
     * restart. For security-sensitive routes only (each counted request is a database write).
     */
    persist?: string;
  }
}

type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;
type ChildOptions = { readonly persist?: string; readonly continueExceeding?: boolean; readonly exponentialBackoff?: boolean; readonly cache?: number };

// The plugin's own in-memory store (not re-exported by the package).
const LocalStore = createRequire(import.meta.url)('@fastify/rate-limit/store/LocalStore.js') as new (
  continueExceeding: boolean,
  exponentialBackoff: boolean,
  cache?: number,
) => FastifyRateLimitStore;

class PersistentStore implements FastifyRateLimitStore {
  readonly #counter: RateLimitCounter;
  readonly #namespace: string;

  constructor(counter: RateLimitCounter, namespace: string) {
    this.#counter = counter;
    this.#namespace = namespace;
  }

  incr(key: string, callback: Callback, timeWindow: number, max: number): void {
    try {
      callback(null, this.#counter.hit(`${this.#namespace}:${key}`, timeWindow, max));
    } catch (error) {
      callback(error as Error);
    }
  }

  read(key: string, callback: Callback): void {
    try {
      callback(null, this.#counter.peek(`${this.#namespace}:${key}`));
    } catch (error) {
      callback(error as Error);
    }
  }

  child(): FastifyRateLimitStore {
    return this;
  }
}

/**
 * Store for `@fastify/rate-limit`: in memory by default (global and ordinary route limits), in the
 * database for limits configured with `persist` when a counter is available.
 */
export function rateLimitStore(counter: RateLimitCounter | undefined): FastifyRateLimitStoreCtor {
  // The plugin passes its merged route parameters to `child`, not the RouteOptions its types name.
  return class RateLimitStore {
    readonly #memory = new LocalStore(false, false);

    incr(key: string, callback: Callback, timeWindow: number, max: number): void {
      this.#memory.incr(key, callback, timeWindow, max);
    }

    child(options: ChildOptions): FastifyRateLimitStore {
      if (options.persist !== undefined && counter !== undefined) return new PersistentStore(counter, options.persist);
      return new LocalStore(options.continueExceeding ?? false, options.exponentialBackoff ?? false, options.cache);
    }
  } as unknown as FastifyRateLimitStoreCtor;
}
