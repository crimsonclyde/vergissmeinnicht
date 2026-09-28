import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAutomaticBackups, runMigrations } from '@vergissmeinnicht/database';
import type { FastifyBaseLogger } from 'fastify';
import { scheduleBackups } from './backup-schedule.ts';

describe('backup schedule (10.5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vmn-schedule-'));
  const live = join(dir, 'vergissmeinnicht.sqlite');
  runMigrations(live);
  afterEach(() => vi.useRealTimers());

  it('is off by default and writes one backup when due', async () => {
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    scheduleBackups(live, log, { intervalHours: 0, keep: 3 })();
    expect(listAutomaticBackups(live)).toHaveLength(0);

    const stop = scheduleBackups(live, log, { intervalHours: 24, keep: 3 }, 50);
    await vi.waitFor(() => expect(listAutomaticBackups(live)).toHaveLength(1));
    // Later checks within the interval write nothing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();
    expect(listAutomaticBackups(live)).toHaveLength(1);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs failures without stopping the server', async () => {
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const stop = scheduleBackups(join(dir, 'missing', 'db.sqlite'), log, { intervalHours: 1, keep: 1 }, 50);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
    stop();
    expect(JSON.stringify((log.error as ReturnType<typeof vi.fn>).mock.calls[0])).toContain('database does not exist');
    rmSync(dir, { recursive: true, force: true });
  });
});
