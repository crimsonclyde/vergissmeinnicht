import { dispatchDueReminders, pollTelegramPairings, type NotificationDeps, type ReminderDeps } from '@vergissmeinnicht/application';
import type { FastifyBaseLogger } from 'fastify';

/** How often due reminders are looked for. */
export const REMINDER_CHECK_MS = 60_000;
/** How often Telegram is asked for /start messages — only while a pairing is open. */
export const TELEGRAM_POLL_MS = 3_000;

/**
 * Runs `task` now and then every `intervalMs`, never twice at once. Failures are logged by type only
 * (messages could contain provider details) and retried at the next tick.
 */
function every(intervalMs: number, name: string, log: FastifyBaseLogger, task: () => Promise<void>): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      log.error({ err: { type: (error as Error).name, code: (error as { code?: unknown }).code } }, `${name} failed`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The reminder scheduler (13.5) inside the server process — no queue, no worker: the database is the
 * source of truth, so a restart simply continues where it stopped. Logs counts only, never
 * recipients, titles or tokens. Returns a function that stops both loops.
 */
export function scheduleReminders(
  deps: { readonly reminders: ReminderDeps; readonly notifications: NotificationDeps },
  log: FastifyBaseLogger,
  intervals: { readonly reminderMs?: number; readonly telegramMs?: number } = {},
): () => void {
  const stopReminders = every(intervals.reminderMs ?? REMINDER_CHECK_MS, 'reminder dispatch', log, async () => {
    const result = await dispatchDueReminders(deps.reminders);
    if (Object.values(result).some((count) => count > 0)) log.info({ reminders: result }, 'reminders processed');
  });
  const stopTelegram = every(intervals.telegramMs ?? TELEGRAM_POLL_MS, 'telegram pairing poll', log, async () => {
    const { claimed } = await pollTelegramPairings(deps.notifications);
    if (claimed > 0) log.info({ telegramPairingsClaimed: claimed }, 'telegram pairing claimed');
  });
  return () => {
    stopReminders();
    stopTelegram();
  };
}
