import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from './actor-guard.ts';
import { calendarFeeds, mfaChallenges, sessions } from './schema.ts';

/**
 * Ends every session and pending sign-in challenge of a user, and turns off their calendar subscription links (39),
 * which would otherwise keep working for someone who copied them. Returns the number of sessions.
 */
export function revokeAllAccess(tx: Transaction, userId: string, now: Date): number {
  tx.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId)).run();
  tx.update(mfaChallenges)
    .set({ consumedAt: now })
    .where(and(eq(mfaChallenges.userId, userId), isNull(mfaChallenges.consumedAt)))
    .run();
  return tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }).all().length;
}
