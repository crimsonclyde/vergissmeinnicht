import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { MfaChallengeRepository, TotpCredential, TotpRepository } from '@vergissmeinnicht/application';
import { MFA_CHALLENGE_MAX_ATTEMPTS, totpLockDurationMs, type UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { mfaChallenges, recoveryCodes, totpCredentials } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type CredentialRow = typeof totpCredentials.$inferSelect;

function toCredential(row: CredentialRow): TotpCredential {
  return {
    userId: row.userId as UserId,
    sealedSecret: row.sealedSecret,
    createdAt: row.createdAt,
    enabledAt: row.enabledAt ?? undefined,
    lastUsedStep: row.lastUsedStep,
    consecutiveFailures: row.consecutiveFailures,
    lockedUntil: row.lockedUntil ?? undefined,
  };
}

const IMMEDIATE = { behavior: 'immediate' } as const;

export function createTotpRepository({ db }: Pick<AppDatabase, 'db'>): TotpRepository {
  const enabled = (userId: UserId) => and(eq(totpCredentials.userId, userId), isNotNull(totpCredentials.enabledAt));

  return {
    async find(userId) {
      const row = db.select().from(totpCredentials).where(eq(totpCredentials.userId, userId)).get();
      return row && toCredential(row);
    },

    async savePendingEnrollment(userId, sealedSecret, now, actor) {
      return db.transaction((tx) => {
        const existing = tx.select().from(totpCredentials).where(eq(totpCredentials.userId, userId)).get();
        if (existing?.enabledAt != null) return false;
        tx.insert(totpCredentials)
          .values({ userId, sealedSecret, createdAt: now })
          .onConflictDoUpdate({
            target: totpCredentials.userId,
            set: { sealedSecret, createdAt: now, lastUsedStep: -1, consecutiveFailures: 0, lockedUntil: null },
          })
          .run();
        recordSecurityEvent(tx, { type: 'TOTP_ENROLLMENT_STARTED', actor, subjectType: 'user', subjectId: userId, occurredAt: now });
        return true;
      }, IMMEDIATE);
    },

    async enable({ userId, pendingCreatedAt, step, recoveryCodeHashes, now, actor }) {
      return db.transaction((tx) => {
        const updated = tx
          .update(totpCredentials)
          .set({ enabledAt: now, lastUsedStep: step, consecutiveFailures: 0, lockedUntil: null })
          .where(
            and(
              eq(totpCredentials.userId, userId),
              isNull(totpCredentials.enabledAt),
              eq(totpCredentials.createdAt, pendingCreatedAt),
              lt(totpCredentials.lastUsedStep, step),
            ),
          )
          .returning({ userId: totpCredentials.userId })
          .all();
        if (updated.length !== 1) return false;
        insertRecoveryCodes(tx, userId, recoveryCodeHashes, now);
        recordSecurityEvent(tx, {
          type: 'TOTP_ENABLED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { recoveryCodes: recoveryCodeHashes.length },
        });
        return true;
      }, IMMEDIATE);
    },

    async acceptStep(userId, step) {
      const updated = db
        .update(totpCredentials)
        .set({ lastUsedStep: step, consecutiveFailures: 0, lockedUntil: null })
        .where(and(enabled(userId), lt(totpCredentials.lastUsedStep, step)))
        .returning({ userId: totpCredentials.userId })
        .all();
      return updated.length === 1;
    },

    async recordFailure(userId, now, actor) {
      db.transaction((tx) => {
        const row = tx
          .update(totpCredentials)
          .set({ consecutiveFailures: sql`${totpCredentials.consecutiveFailures} + 1` })
          .where(enabled(userId))
          .returning({ failures: totpCredentials.consecutiveFailures })
          .get();
        if (row === undefined) return;
        recordSecurityEvent(tx, {
          type: 'TOTP_CODE_REJECTED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { consecutiveFailures: row.failures },
        });
        const lockMs = totpLockDurationMs(row.failures);
        if (lockMs === 0) return;
        const lockedUntil = new Date(now.getTime() + lockMs);
        tx.update(totpCredentials).set({ lockedUntil }).where(eq(totpCredentials.userId, userId)).run();
        recordSecurityEvent(tx, {
          type: 'TOTP_LOCKED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { lockedUntil: lockedUntil.toISOString(), consecutiveFailures: row.failures },
        });
      }, IMMEDIATE);
    },

    async consumeRecoveryCode(userId, codeHash, now, actor) {
      return db.transaction((tx) => {
        const used = tx
          .update(recoveryCodes)
          .set({ usedAt: now })
          .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
          .returning({ id: recoveryCodes.id })
          .all();
        if (used.length !== 1) return undefined;
        const remaining = remainingIn(tx, userId);
        recordSecurityEvent(tx, {
          type: 'RECOVERY_CODE_USED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { remaining },
        });
        return remaining;
      }, IMMEDIATE);
    },

    async replaceRecoveryCodes(userId, codeHashes, now, actor) {
      return db.transaction((tx) => {
        if (tx.select({ userId: totpCredentials.userId }).from(totpCredentials).where(enabled(userId)).get() === undefined) {
          return false;
        }
        tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
        insertRecoveryCodes(tx, userId, codeHashes, now);
        recordSecurityEvent(tx, {
          type: 'RECOVERY_CODES_REGENERATED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { recoveryCodes: codeHashes.length },
        });
        return true;
      }, IMMEDIATE);
    },

    async disable(userId, now, actor) {
      return db.transaction((tx) => {
        // Recovery codes are removed by the FK cascade.
        const deleted = tx.delete(totpCredentials).where(enabled(userId)).returning({ userId: totpCredentials.userId }).all();
        if (deleted.length !== 1) return false;
        recordSecurityEvent(tx, { type: 'TOTP_DISABLED', actor, subjectType: 'user', subjectId: userId, occurredAt: now });
        return true;
      }, IMMEDIATE);
    },

    async remainingRecoveryCodes(userId) {
      return remainingIn(db, userId);
    },
  };
}

type Tx = Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0];

function insertRecoveryCodes(tx: Tx, userId: string, hashes: readonly string[], now: Date) {
  if (hashes.length === 0) return;
  tx.insert(recoveryCodes)
    .values(hashes.map((codeHash) => ({ id: randomUUID(), userId, codeHash, createdAt: now })))
    .run();
}

function remainingIn(tx: Tx | AppDatabase['db'], userId: string): number {
  return (
    tx
      .select({ n: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
      .get()?.n ?? 0
  );
}

export function createMfaChallengeRepository({ db }: Pick<AppDatabase, 'db'>): MfaChallengeRepository {
  const active = (now: Date) =>
    and(
      isNull(mfaChallenges.consumedAt),
      gt(mfaChallenges.expiresAt, now),
      lt(mfaChallenges.attempts, MFA_CHALLENGE_MAX_ATTEMPTS),
    );

  return {
    async create(input, actor) {
      db.transaction((tx) => {
        const id = randomUUID();
        tx.insert(mfaChallenges).values({ id, ...input }).run();
        recordSecurityEvent(tx, {
          type: 'MFA_CHALLENGE_STARTED',
          actor,
          subjectType: 'mfa_challenge',
          subjectId: id,
          occurredAt: input.createdAt,
        });
      }, IMMEDIATE);
    },

    async findActive(tokenHash, now) {
      const row = db
        .select({ id: mfaChallenges.id, userId: mfaChallenges.userId, attempts: mfaChallenges.attempts })
        .from(mfaChallenges)
        .where(and(eq(mfaChallenges.tokenHash, tokenHash), active(now)))
        .get();
      return row && { ...row, userId: row.userId as UserId };
    },

    async recordAttempt(id, now) {
      const updated = db
        .update(mfaChallenges)
        .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
        .where(and(eq(mfaChallenges.id, id), active(now)))
        .returning({ id: mfaChallenges.id })
        .all();
      return updated.length === 1;
    },

    async consume(id, now) {
      const updated = db
        .update(mfaChallenges)
        .set({ consumedAt: now })
        .where(and(eq(mfaChallenges.id, id), isNull(mfaChallenges.consumedAt), gt(mfaChallenges.expiresAt, now)))
        .returning({ id: mfaChallenges.id })
        .all();
      return updated.length === 1;
    },
  };
}
