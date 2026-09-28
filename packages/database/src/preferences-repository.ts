import { eq } from 'drizzle-orm';
import type { PreferencesRepository } from '@vergissmeinnicht/application';
import type { AppDatabase } from './connection.ts';
import { userPreferences } from './schema.ts';

export function createPreferencesRepository({ db }: Pick<AppDatabase, 'db'>): PreferencesRepository {
  return {
    async find(userId) {
      const row = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
      return row && { theme: row.theme, criticalConfirm: row.criticalConfirm };
    },

    async save(userId, preferences, at) {
      db.insert(userPreferences)
        .values({ userId, ...preferences, updatedAt: at })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { ...preferences, updatedAt: at } })
        .run();
    },
  };
}
