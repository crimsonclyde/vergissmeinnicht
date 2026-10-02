import { purgeExpired, type AppDatabase } from '@vergissmeinnicht/database';
import type { FastifyBaseLogger } from 'fastify';

export const HOUSEKEEPING_INTERVAL_MS = 60 * 60_000;

/**
 * Runs `purgeExpired` at startup and then hourly (Step 2.8), and — when given — the removal of unused
 * instruction images and orphan files (14.3) and of document files nothing uses (16.1), after which
 * unfinished document previews are taken up again. Failures are logged and retried at the next
 * interval; they never stop the server. Returns a function that stops the schedule.
 */
export function scheduleHousekeeping(
  database: Pick<AppDatabase, 'db'>,
  log: FastifyBaseLogger,
  intervalMs = HOUSEKEEPING_INTERVAL_MS,
  purgeImages?: () => Promise<{ readonly files: number }>,
  documents?: { readonly purge: () => Promise<{ readonly files: number }>; readonly resumePreviews: () => Promise<number> },
) {
  const run = () => {
    try {
      const deleted = purgeExpired(database);
      if (Object.values(deleted).some((count) => count > 0)) log.info({ housekeeping: deleted }, 'expired rows deleted');
    } catch (error) {
      log.error({ err: { type: (error as Error).name } }, 'housekeeping failed');
    }
    purgeImages?.().then(
      ({ files }) => {
        if (files > 0) log.info({ housekeeping: { imageFiles: files } }, 'unused image files deleted');
      },
      (error: unknown) => log.error({ err: { type: (error as Error).name } }, 'image housekeeping failed'),
    );
    documents
      ?.purge()
      .then(({ files }) => {
        if (files > 0) log.info({ housekeeping: { documentFiles: files } }, 'unused document files deleted');
        return documents.resumePreviews();
      })
      .then(
        (previews) => {
          if (previews !== undefined && previews > 0) log.info({ housekeeping: { documentPreviews: previews } }, 'document previews resumed');
        },
        (error: unknown) => log.error({ err: { type: (error as Error).name } }, 'document file housekeeping failed'),
      );
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
