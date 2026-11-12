import type { CalendarFeedRepository } from '@vergissmeinnicht/application';
import type { CalendarFeed, WorkspaceId } from '@vergissmeinnicht/domain';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { recordSecurityEvent } from './security-events.ts';
import { calendarFeeds } from './schema.ts';

function toFeed(row: typeof calendarFeeds.$inferSelect): CalendarFeed {
  return { userId: row.userId, workspaceId: row.workspaceId as WorkspaceId, scope: row.scope, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
}

/** Calendar subscription links (39). Only the token's SHA-256 is stored; events never carry the token or its hash. */
export function createCalendarFeedRepository({ db }: Pick<AppDatabase, 'db'>): CalendarFeedRepository {
  const own = (userId: string, workspaceId: string) => and(eq(calendarFeeds.userId, userId), eq(calendarFeeds.workspaceId, workspaceId));
  return {
    async find(userId, workspaceId) {
      const row = db.select().from(calendarFeeds).where(own(userId, workspaceId)).get();
      return row && toFeed(row);
    },

    async save(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' as const };
        const replaced = tx.delete(calendarFeeds).where(own(actor.userId, input.workspaceId)).returning({ userId: calendarFeeds.userId }).all().length > 0;
        const row = tx
          .insert(calendarFeeds)
          .values({ userId: actor.userId, workspaceId: input.workspaceId, tokenHash: input.tokenHash, scope: input.scope, createdAt: input.at, lastUsedAt: null })
          .returning()
          .get();
        recordSecurityEvent(tx, {
          type: 'CALENDAR_FEED_CHANGED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { change: replaced ? 'replaced' : 'created', scope: input.scope },
        });
        return { status: 'ok' as const, feed: toFeed(row) };
      }, IMMEDIATE);
    },

    async setScope(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' as const };
        const row = tx.update(calendarFeeds).set({ scope: input.scope }).where(own(actor.userId, input.workspaceId)).returning().get();
        if (row === undefined) return { status: 'not_found' as const };
        recordSecurityEvent(tx, { type: 'CALENDAR_FEED_CHANGED', actor, subjectType: 'workspace', subjectId: input.workspaceId, occurredAt: input.at, metadata: { change: 'scope', scope: input.scope } });
        return { status: 'ok' as const, feed: toFeed(row) };
      }, IMMEDIATE);
    },

    async remove(input, actor) {
      return db.transaction((tx) => {
        const removed = tx.delete(calendarFeeds).where(own(actor.userId, input.workspaceId)).returning({ userId: calendarFeeds.userId }).all().length > 0;
        if (!removed) return 'not_found' as const;
        recordSecurityEvent(tx, { type: 'CALENDAR_FEED_CHANGED', actor, subjectType: 'workspace', subjectId: input.workspaceId, occurredAt: input.at, metadata: { change: 'removed' } });
        return 'ok' as const;
      }, IMMEDIATE);
    },

    async findByTokenHash(tokenHash) {
      const row = db.select().from(calendarFeeds).where(eq(calendarFeeds.tokenHash, tokenHash)).get();
      return row && toFeed(row);
    },

    async touch(tokenHash, at, minIntervalMs) {
      db.update(calendarFeeds)
        .set({ lastUsedAt: at })
        .where(and(eq(calendarFeeds.tokenHash, tokenHash), or(isNull(calendarFeeds.lastUsedAt), lt(calendarFeeds.lastUsedAt, new Date(at.getTime() - minIntervalMs)))))
        .run();
    },
  };
}
