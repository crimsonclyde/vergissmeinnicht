import { TOTP_ENROLLMENT_TTL_MS } from '@vergissmeinnicht/domain';
import { and, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import {
  accountRecoveries,
  invitations,
  mfaChallenges,
  rateLimits,
  sessions,
  totpCredentials,
  verifications,
} from './schema.ts';

const DAY_MS = 86_400_000;

/**
 * How long finished invitation and recovery records are kept (accepted, revoked or expired). Their
 * security events stay forever; the rows only hold token hashes and outcome timestamps.
 */
export const FINISHED_LINK_RETENTION_MS = 30 * DAY_MS;

export interface HousekeepingResult {
  readonly sessions: number;
  readonly verifications: number;
  readonly mfaChallenges: number;
  readonly totpEnrollments: number;
  readonly accountRecoveries: number;
  readonly invitations: number;
  readonly rateLimits: number;
}

/**
 * Deletes rows that can no longer be used (Step 2.8): expired sessions and verification values,
 * used or expired sign-in challenges, abandoned TOTP enrollments, expired rate-limit windows, and
 * invitations / account recoveries finished more than 30 days ago. Never touches security events,
 * audit events, Runs, Knots or anything a user can still act on. One transaction.
 */
export function purgeExpired({ db }: Pick<AppDatabase, 'db'>, now: Date = new Date()): HousekeepingResult {
  const cutoff = new Date(now.getTime() - FINISHED_LINK_RETENTION_MS);
  const deleted = (rows: unknown[]) => rows.length;
  return db.transaction(
    (tx) => ({
      sessions: deleted(tx.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id }).all()),
      verifications: deleted(tx.delete(verifications).where(lte(verifications.expiresAt, now)).returning({ id: verifications.id }).all()),
      mfaChallenges: deleted(
        tx
          .delete(mfaChallenges)
          .where(or(lte(mfaChallenges.expiresAt, now), isNotNull(mfaChallenges.consumedAt)))
          .returning({ id: mfaChallenges.id })
          .all(),
      ),
      // Unconfirmed enrollments are useless after their TTL (recovery codes only exist once confirmed).
      totpEnrollments: deleted(
        tx
          .delete(totpCredentials)
          .where(and(isNull(totpCredentials.enabledAt), lte(totpCredentials.createdAt, new Date(now.getTime() - TOTP_ENROLLMENT_TTL_MS))))
          .returning({ userId: totpCredentials.userId })
          .all(),
      ),
      accountRecoveries: deleted(
        tx
          .delete(accountRecoveries)
          .where(
            or(
              lte(accountRecoveries.completedAt, cutoff),
              lte(accountRecoveries.revokedAt, cutoff),
              and(isNull(accountRecoveries.completedAt), isNull(accountRecoveries.revokedAt), lte(accountRecoveries.expiresAt, cutoff)),
            ),
          )
          .returning({ id: accountRecoveries.id })
          .all(),
      ),
      invitations: deleted(
        tx
          .delete(invitations)
          .where(
            or(
              lte(invitations.acceptedAt, cutoff),
              lte(invitations.revokedAt, cutoff),
              and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), lte(invitations.expiresAt, cutoff)),
            ),
          )
          .returning({ id: invitations.id })
          .all(),
      ),
      rateLimits: deleted(
        tx
          .delete(rateLimits)
          .where(lte(sql`${rateLimits.windowStart} + ${rateLimits.windowMs}`, now.getTime()))
          .returning({ keyHash: rateLimits.keyHash })
          .all(),
      ),
    }),
    IMMEDIATE,
  );
}
