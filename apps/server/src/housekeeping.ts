import { purgeExpired, type AppDatabase } from '@vergissmeinnicht/database';
import type { FastifyBaseLogger } from 'fastify';

export const HOUSEKEEPING_INTERVAL_MS = 60 * 60_000;

/**
 * Runs `purgeExpired` at startup and then hourly (Step 2.8). Failures are logged and retried at the
 * next interval; they never stop the server. Returns a function that stops the schedule.
 */
export function scheduleHousekeeping(database: Pick<AppDatabase, 'db'>, log: FastifyBaseLogger, intervalMs = HOUSEKEEPING_INTERVAL_MS) {
  const run = () => {
    try {
      const deleted = purgeExpired(database);
      if (Object.values(deleted).some((count) => count > 0)) log.info({ housekeeping: deleted }, 'expired rows deleted');
    } catch (error) {
      log.error({ err: { type: (error as Error).name } }, 'housekeeping failed');
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
