import { eq } from 'drizzle-orm';
import type { TodayLayoutRepository } from '@vergissmeinnicht/application';
import type { AppDatabase } from './connection.ts';
import { userTodayLayouts } from './schema.ts';

export function createTodayLayoutRepository({ db }: Pick<AppDatabase, 'db'>): TodayLayoutRepository {
  return {
    async find(userId) {
      const row = db.select().from(userTodayLayouts).where(eq(userTodayLayouts.userId, userId)).get();
      if (row === undefined) return undefined;
      // Valid JSON by the table's CHECK; the content is read tolerantly by the client.
      return { layout: JSON.parse(row.layout) as unknown, version: row.version, updatedAt: row.updatedAt };
    },

    async save(userId, layout, version, at) {
      const text = JSON.stringify(layout);
      db.insert(userTodayLayouts)
        .values({ userId, layout: text, version, updatedAt: at })
        .onConflictDoUpdate({ target: userTodayLayouts.userId, set: { layout: text, version, updatedAt: at } })
        .run();
    },

    async remove(userId) {
      db.delete(userTodayLayouts).where(eq(userTodayLayouts.userId, userId)).run();
    },
  };
}
