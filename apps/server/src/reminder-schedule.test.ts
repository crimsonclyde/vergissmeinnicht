import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDeps, ReminderDeps } from '@vergissmeinnicht/application';
import type { FastifyBaseLogger } from 'fastify';
import { scheduleReminders } from './reminder-schedule.ts';

describe('reminder scheduler (13.5)', () => {
  afterEach(() => vi.useRealTimers());

  it('never runs two dispatches at once and logs counts and error types only', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let release: () => void = () => undefined;
    const queue = {
      due: async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => (release = resolve));
        active--;
        if (calls === 2) throw Object.assign(new Error('secret-bearing message https://api.telegram.org/bot1:x'), { code: 'SQLITE_BUSY' });
        return [];
      },
    };
    const reminders = { queue, notifiers: [], clock: { now: () => new Date() }, publicOrigin: 'https://x' } as unknown as ReminderDeps;
    const notifications = { telegram: { anyOpenPairing: async () => false } } as unknown as NotificationDeps;
    const error = vi.fn();
    const log = { info: vi.fn(), error } as unknown as FastifyBaseLogger;

    const stop = scheduleReminders({ reminders, notifications }, log, { reminderMs: 100, telegramMs: 100 });
    await vi.advanceTimersByTimeAsync(350); // three more ticks while the first dispatch still runs
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxActive).toBe(1);
    expect(error).toHaveBeenCalledWith({ err: { type: 'Error', code: 'SQLITE_BUSY' } }, 'reminder dispatch failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain('api.telegram.org');
    stop();
  });
});
