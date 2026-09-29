import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { NotificationProviderRepository, ProviderState, TelegramLink, TelegramPairing, TelegramRepository } from '@vergissmeinnicht/application';
import type { UserId } from '@vergissmeinnicht/domain';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { notificationProviders, telegramLinks, telegramPairings, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

/** Defaults without a row: email reminders on (SMTP is part of every deployment), Telegram off. */
const DEFAULTS: Record<'EMAIL' | 'TELEGRAM', ProviderState> = {
  EMAIL: { enabled: true, hasSecret: false, publicLabel: null },
  TELEGRAM: { enabled: false, hasSecret: false, publicLabel: null },
};

export function createNotificationProviderRepository({ db }: Pick<AppDatabase, 'db'>): NotificationProviderRepository {
  const row = (provider: 'EMAIL' | 'TELEGRAM') => db.select().from(notificationProviders).where(eq(notificationProviders.provider, provider)).get();
  return {
    async get(provider) {
      const found = row(provider);
      return found === undefined ? DEFAULTS[provider] : { enabled: found.enabled, hasSecret: found.sealedSecret !== null, publicLabel: found.publicLabel };
    },

    async sealedSecret(provider) {
      return row(provider)?.sealedSecret ?? null;
    },

    async save(provider, change, at, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return false;
        const set = {
          enabled: change.enabled,
          ...(change.sealedSecret === undefined ? {} : { sealedSecret: change.sealedSecret }),
          ...(change.publicLabel === undefined ? {} : { publicLabel: change.publicLabel }),
          updatedAt: at,
          updatedByUserId: actor.userId,
        };
        tx.insert(notificationProviders)
          .values({ provider, ...set })
          .onConflictDoUpdate({ target: notificationProviders.provider, set })
          .run();
        recordSecurityEvent(tx, {
          type: 'NOTIFICATION_PROVIDER_CHANGED',
          actor,
          subjectType: 'notification_provider',
          subjectId: provider,
          occurredAt: at,
          // Whether a credential was replaced or removed — never the credential.
          metadata: {
            enabled: change.enabled,
            ...(change.sealedSecret === undefined ? {} : { credential: change.sealedSecret === null ? 'removed' : 'replaced' }),
          },
        });
        return true;
      }, IMMEDIATE);
    },

    async pollOffset() {
      return row('TELEGRAM')?.pollOffset ?? null;
    },

    async savePollOffset(offset) {
      db.update(notificationProviders).set({ pollOffset: offset }).where(eq(notificationProviders.provider, 'TELEGRAM')).run();
    },
  };
}

type PairingRow = typeof telegramPairings.$inferSelect;
const toPairing = (row: PairingRow): TelegramPairing => ({ id: row.id, expiresAt: row.expiresAt, claimedBy: row.chatLabel });
const openIn = (now: Date) => and(isNull(telegramPairings.completedAt), isNull(telegramPairings.cancelledAt), gt(telegramPairings.expiresAt, now));

export function createTelegramRepository({ db }: Pick<AppDatabase, 'db'>): TelegramRepository {
  return {
    async link(userId) {
      const row = db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)).get();
      return row && { chatId: row.chatId, chatLabel: row.chatLabel, connectedAt: row.connectedAt };
    },

    async createPairing(input) {
      return db.transaction((tx) => {
        // One open pairing per person: a new link makes earlier ones useless.
        tx.update(telegramPairings)
          .set({ cancelledAt: input.at })
          .where(and(eq(telegramPairings.userId, input.userId), isNull(telegramPairings.completedAt), isNull(telegramPairings.cancelledAt)))
          .run();
        const row = tx
          .insert(telegramPairings)
          .values({ id: randomUUID(), userId: input.userId, tokenHash: input.tokenHash, createdAt: input.at, expiresAt: input.expiresAt })
          .returning()
          .get();
        return toPairing(row);
      }, IMMEDIATE);
    },

    async openPairing(userId, now) {
      const row = db
        .select()
        .from(telegramPairings)
        .where(and(eq(telegramPairings.userId, userId), openIn(now)))
        .orderBy(desc(telegramPairings.createdAt))
        .get();
      return row && toPairing(row);
    },

    async anyOpenPairing(now) {
      return db.select({ id: telegramPairings.id }).from(telegramPairings).where(openIn(now)).get() !== undefined;
    },

    async claimPairing(input) {
      const result = db
        .update(telegramPairings)
        .set({ claimedAt: input.at, chatId: input.chatId, chatLabel: input.chatLabel })
        .where(and(eq(telegramPairings.tokenHash, input.tokenHash), isNull(telegramPairings.claimedAt), openIn(input.at)))
        .run();
      return result.changes === 1;
    },

    async confirmPairing(userId, pairingId, at, actor) {
      return db.transaction((tx): TelegramLink | undefined => {
        const pairing = tx
          .select()
          .from(telegramPairings)
          .where(and(eq(telegramPairings.id, pairingId), eq(telegramPairings.userId, userId), openIn(at)))
          .get();
        if (pairing?.chatId == null || pairing.chatLabel === null) return undefined;
        tx.update(telegramPairings).set({ completedAt: at }).where(eq(telegramPairings.id, pairing.id)).run();
        const link = { chatId: pairing.chatId, chatLabel: pairing.chatLabel, connectedAt: at };
        tx.insert(telegramLinks)
          .values({ userId, ...link })
          .onConflictDoUpdate({ target: telegramLinks.userId, set: link })
          .run();
        recordSecurityEvent(tx, {
          type: 'TELEGRAM_CONNECTED',
          actor,
          subjectType: 'user',
          subjectId: userId,
          occurredAt: at,
          metadata: { chat: pairing.chatLabel },
        });
        return link;
      }, IMMEDIATE);
    },

    async cancelPairings(userId, at) {
      db.update(telegramPairings)
        .set({ cancelledAt: at })
        .where(and(eq(telegramPairings.userId, userId), isNull(telegramPairings.completedAt), isNull(telegramPairings.cancelledAt)))
        .run();
    },

    async disconnect(userId: UserId, at, actor) {
      return db.transaction((tx) => {
        const removed = tx.delete(telegramLinks).where(eq(telegramLinks.userId, userId)).run().changes === 1;
        if (removed) {
          recordSecurityEvent(tx, { type: 'TELEGRAM_DISCONNECTED', actor, subjectType: 'user', subjectId: userId, occurredAt: at });
        }
        return removed;
      }, IMMEDIATE);
    },
  };
}
