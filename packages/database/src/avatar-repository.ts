import { and, eq, inArray } from 'drizzle-orm';
import type { AvatarRepository } from '@vergissmeinnicht/application';
import type { UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { IMMEDIATE } from './actor-guard.ts';
import { memberships, userAvatars, users } from './schema.ts';

const versionOf = (at: Date) => String(at.getTime());

/** Profile pictures (section 29). Reads of other people's pictures always require a current membership. */
export function createAvatarRepository({ db }: Pick<AppDatabase, 'db'>): AvatarRepository {
  return {
    async find(userId) {
      const row = db.select({ jpeg: userAvatars.jpeg, updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, userId)).get();
      return row && { jpeg: new Uint8Array(row.jpeg), version: versionOf(row.updatedAt) };
    },

    async findMember(workspaceId, userId) {
      const row = db
        .select({ jpeg: userAvatars.jpeg })
        .from(userAvatars)
        .innerJoin(users, eq(users.id, userAvatars.userId))
        .innerJoin(memberships, and(eq(memberships.userId, userAvatars.userId), eq(memberships.workspaceId, workspaceId)))
        .where(and(eq(userAvatars.userId, userId), eq(users.status, 'ACTIVE')))
        .get();
      return row && new Uint8Array(row.jpeg);
    },

    async versions(userIds) {
      const found = new Map<UserId, string>();
      if (userIds.length === 0) return found;
      const rows = db
        .select({ userId: userAvatars.userId, updatedAt: userAvatars.updatedAt })
        .from(userAvatars)
        .innerJoin(users, eq(users.id, userAvatars.userId))
        .where(and(inArray(userAvatars.userId, [...userIds]), eq(users.status, 'ACTIVE')))
        .all();
      for (const row of rows) found.set(row.userId as UserId, versionOf(row.updatedAt));
      return found;
    },

    async save({ userId, jpeg, at }) {
      return db.transaction((tx) => {
        const active = tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'))).get();
        if (active === undefined) return undefined;
        const bytes = Buffer.from(jpeg);
        tx.insert(userAvatars).values({ userId, jpeg: bytes, updatedAt: at }).onConflictDoUpdate({ target: userAvatars.userId, set: { jpeg: bytes, updatedAt: at } }).run();
        return versionOf(at);
      }, IMMEDIATE);
    },

    async remove(userId) {
      db.delete(userAvatars).where(eq(userAvatars.userId, userId)).run();
    },
  };
}
