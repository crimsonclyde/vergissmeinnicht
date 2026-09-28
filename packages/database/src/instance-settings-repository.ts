import { DEFAULT_INSTANCE_SETTINGS, type InstanceSettingsRepository } from '@vergissmeinnicht/application';
import { eq } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { instanceSettings, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

export function createInstanceSettingsRepository({ db }: Pick<AppDatabase, 'db'>): InstanceSettingsRepository {
  return {
    async get() {
      const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).get();
      return row === undefined ? DEFAULT_INSTANCE_SETTINGS : { footerHidden: row.footerHidden };
    },

    async save(settings, at, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return false;
        tx.insert(instanceSettings)
          .values({ id: 1, footerHidden: settings.footerHidden, updatedAt: at, updatedByUserId: actor.userId })
          .onConflictDoUpdate({ target: instanceSettings.id, set: { footerHidden: settings.footerHidden, updatedAt: at, updatedByUserId: actor.userId } })
          .run();
        recordSecurityEvent(tx, {
          type: 'INSTANCE_SETTINGS_CHANGED',
          actor,
          subjectType: 'instance',
          subjectId: 'settings',
          occurredAt: at,
          metadata: { footerHidden: settings.footerHidden },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}
