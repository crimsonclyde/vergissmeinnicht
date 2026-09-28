import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import type { FastifyBaseLogger } from 'fastify';
import { scheduleHousekeeping } from './housekeeping.ts';

describe('housekeeping schedule', () => {
  const database = createTestDatabase();
  afterEach(() => vi.useRealTimers());

  it('purges at start and on every interval, and logs counts only', () => {
    vi.useFakeTimers();
    const info = vi.fn();
    const log = { info, error: vi.fn() } as unknown as FastifyBaseLogger;
    const userId = randomUUID();
    database.sqlite.prepare("INSERT INTO users (id, display_name, email) VALUES (?, 'Ada', 'ada@example.org')").run(userId);
    const expiredSession = () =>
      database.sqlite.prepare('INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)').run(randomUUID(), randomUUID(), userId, 1);
    expiredSession();

    const stop = scheduleHousekeeping(database, log, 1000);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toEqual({ housekeeping: expect.objectContaining({ sessions: 1 }) });
    expiredSession();
    vi.advanceTimersByTime(1000);
    expect(info).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(info).toHaveBeenCalledTimes(2); // nothing deleted, nothing logged
    stop();
    expiredSession();
    vi.advanceTimersByTime(5000);
    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain('ada');
    database.dispose();
  });
});
