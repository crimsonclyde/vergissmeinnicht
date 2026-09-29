import { eq } from 'drizzle-orm';
import type { NotificationPreferencesRepository } from '@vergissmeinnicht/application';
import type { LocalTime } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { notificationPreferences } from './schema.ts';

export function createNotificationPreferencesRepository({ db }: Pick<AppDatabase, 'db'>): NotificationPreferencesRepository {
  return {
    async find(userId) {
      const row = db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).get();
      return row && { reminderTime: row.reminderTime as LocalTime, emailReminders: row.emailReminders, telegramReminders: row.telegramReminders };
    },

    async save(userId, preferences, at) {
      const values = { reminderTime: preferences.reminderTime, emailReminders: preferences.emailReminders, telegramReminders: preferences.telegramReminders };
      db.insert(notificationPreferences)
        .values({ userId, ...values, updatedAt: at })
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...values, updatedAt: at } })
        .run();
    },
  };
}
