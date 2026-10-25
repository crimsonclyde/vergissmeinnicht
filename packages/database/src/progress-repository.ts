import { createHash } from 'node:crypto';
import type { ProgressRepository } from '@vergissmeinnicht/application';
import { DAILY_PROGRESS_LIMIT, progressPoints } from '@vergissmeinnicht/domain';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { progressAwards, users } from './schema.ts';

/** Called only inside an already-authorized mutation transaction. No content or source ids stored. */
export function awardProgress(tx: Transaction, userId: string, source: string, type: string, at: Date, metadata: Readonly<Record<string, unknown>> = {}): void {
  const wanted = progressPoints(type, metadata);
  if (wanted === 0 || tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).get()?.status !== 'ACTIVE') return;
  // Global per logical action: collaborators, undo/re-complete and retries cannot award it twice.
  const key = createHash('sha256').update(`${type}:${source}`).digest('hex');
  if (tx.select({ key: progressAwards.key }).from(progressAwards).where(eq(progressAwards.key, key)).get()) return;
  const start = new Date(at); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  const earned = tx.select({ n: sql<number>`coalesce(sum(${progressAwards.points}), 0)` }).from(progressAwards).where(and(eq(progressAwards.userId, userId), gte(progressAwards.at, start), lt(progressAwards.at, end))).get()?.n ?? 0;
  // A zero-point mark still consumes the action after the daily cap, so it cannot be replayed later.
  tx.insert(progressAwards).values({ key, userId, points: Math.max(0, Math.min(wanted, DAILY_PROGRESS_LIMIT - earned)), at }).onConflictDoNothing().run();
}
export function createProgressRepository({ db }: Pick<AppDatabase, 'db'>): ProgressRepository {
  return { async read(userId) {
    if (db.select({ status: users.status }).from(users).where(eq(users.id, userId)).get()?.status !== 'ACTIVE') return undefined;
    const points = db.select({ n: sql<number>`coalesce(sum(${progressAwards.points}), 0)` }).from(progressAwards).where(eq(progressAwards.userId, userId)).get()?.n ?? 0;
    return { points };
  } };
}
