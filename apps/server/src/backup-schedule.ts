import { backupIfDue } from '@vergissmeinnicht/database';
import type { FastifyBaseLogger } from 'fastify';

/** How often the schedule looks whether a backup is due (the interval itself is in hours). */
export const BACKUP_CHECK_MS = 10 * 60_000;

/**
 * Scheduled automatic backups (Step 10.5): checks at start and every 10 minutes whether the newest
 * automatic backup is older than the interval, writes a verified one if so and keeps the newest
 * `keep`. Never runs twice at once; failures are logged and retried at the next check. Returns a
 * function that stops the schedule.
 */
export function scheduleBackups(
  databasePath: string,
  log: FastifyBaseLogger,
  options: { readonly intervalHours: number; readonly keep: number },
  checkMs = BACKUP_CHECK_MS,
): () => void {
  if (options.intervalHours <= 0 || databasePath === ':memory:') return () => undefined;
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const result = await backupIfDue(databasePath, { intervalMs: options.intervalHours * 3_600_000, keep: options.keep });
      if (result.written !== null) log.info({ backup: result.written, removed: result.removed.length }, 'automatic backup written');
    } catch (error) {
      // BackupError messages name the problem, never data.
      log.error({ err: { type: (error as Error).name, message: (error as Error).message } }, 'automatic backup failed');
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), checkMs);
  timer.unref();
  return () => clearInterval(timer);
}
