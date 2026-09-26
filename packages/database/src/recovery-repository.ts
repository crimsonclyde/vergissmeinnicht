import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AccountRecoveryRepository, CredentialRepository } from '@vergissmeinnicht/application';
import type { AccountRecovery, AccountRecoveryId, UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { accountRecoveries, accounts, mfaChallenges, sessions, totpCredentials } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type RecoveryRow = typeof accountRecoveries.$inferSelect;
type Tx = Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0];

const IMMEDIATE = { behavior: 'immediate' } as const;

function toRecovery(row: RecoveryRow): AccountRecovery {
  return {
    id: row.id as AccountRecoveryId,
    userId: row.userId as UserId,
    resetPassword: row.resetPassword,
    resetTotp: row.resetTotp,
    issuedBy: (row.issuedByUserId ?? undefined) as UserId | undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
  };
}

const pending = (now: Date) =>
  and(isNull(accountRecoveries.completedAt), isNull(accountRecoveries.revokedAt), gt(accountRecoveries.expiresAt, now));

/** Ends every session and pending sign-in challenge of a user. Returns the number of sessions. */
function revokeAllAccess(tx: Tx, userId: string, now: Date): number {
  tx.update(mfaChallenges)
    .set({ consumedAt: now })
    .where(and(eq(mfaChallenges.userId, userId), isNull(mfaChallenges.consumedAt)))
    .run();
  return tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }).all().length;
}

function replacePasswordHash(tx: Tx, userId: string, passwordHash: string, now: Date): boolean {
  const updated = tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: now })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .returning({ id: accounts.id })
    .all();
  return updated.length === 1;
}

export function createAccountRecoveryRepository({ db }: Pick<AppDatabase, 'db'>): AccountRecoveryRepository {
  return {
    async issue(input, actor) {
      return db.transaction((tx) => {
        const superseded = tx
          .update(accountRecoveries)
          .set({ revokedAt: input.createdAt })
          .where(and(eq(accountRecoveries.userId, input.userId), pending(input.createdAt)))
          .returning({ id: accountRecoveries.id })
          .all();
        for (const { id } of superseded) {
          recordSecurityEvent(tx, {
            type: 'ACCOUNT_RECOVERY_SUPERSEDED',
            actor,
            subjectType: 'user',
            subjectId: input.userId,
            occurredAt: input.createdAt,
            metadata: { recoveryId: id },
          });
        }
        const row = tx
          .insert(accountRecoveries)
          .values({
            id: randomUUID(),
            ...input,
            issuedByUserId: actor.kind === 'user' ? actor.userId : null,
          })
          .returning()
          .get();
        recordSecurityEvent(tx, {
          type: 'ACCOUNT_RECOVERY_ISSUED',
          actor,
          subjectType: 'user',
          subjectId: input.userId,
          occurredAt: input.createdAt,
          metadata: {
            recoveryId: row.id,
            resetPassword: row.resetPassword,
            resetTotp: row.resetTotp,
            expiresAt: row.expiresAt.toISOString(),
          },
        });
        return toRecovery(row);
      }, IMMEDIATE);
    },

    async findByTokenHash(tokenHash) {
      const row = db.select().from(accountRecoveries).where(eq(accountRecoveries.tokenHash, tokenHash)).get();
      return row && toRecovery(row);
    },

    async complete({ id, passwordHash, now, actor }) {
      return db.transaction((tx) => {
        const claimed = tx
          .update(accountRecoveries)
          .set({ completedAt: now })
          .where(and(eq(accountRecoveries.id, id), pending(now)))
          .returning()
          .get();
        if (claimed === undefined) return false;
        const userId = claimed.userId;
        const event = { actor, subjectType: 'user' as const, subjectId: userId, occurredAt: now };

        if (claimed.resetPassword) {
          if (passwordHash === undefined || !replacePasswordHash(tx, userId, passwordHash, now)) {
            tx.rollback();
          }
          recordSecurityEvent(tx, { ...event, type: 'PASSWORD_RESET', metadata: { recoveryId: id } });
        }
        if (claimed.resetTotp) {
          // Recovery codes go with the credential (FK cascade).
          tx.delete(totpCredentials).where(eq(totpCredentials.userId, userId)).run();
          recordSecurityEvent(tx, { ...event, type: 'TOTP_RESET', metadata: { recoveryId: id } });
        }
        const sessionsRevoked = revokeAllAccess(tx, userId, now);
        recordSecurityEvent(tx, {
          ...event,
          type: 'ACCOUNT_RECOVERY_COMPLETED',
          metadata: { recoveryId: id, sessionsRevoked },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}

export function createCredentialRepository({ db }: Pick<AppDatabase, 'db'>): CredentialRepository {
  return {
    async changePassword(userId, passwordHash, now, actor) {
      return db.transaction((tx) => {
        if (!replacePasswordHash(tx, userId, passwordHash, now)) return false;
        const sessionsRevoked = revokeAllAccess(tx, userId, now);
        recordSecurityEvent(tx, {
          type: 'PASSWORD_CHANGED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: now,
          metadata: { sessionsRevoked },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}
