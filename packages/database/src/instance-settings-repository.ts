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
      return row === undefined ? DEFAULT_INSTANCE_SETTINGS : { footerHidden: row.footerHidden, recentProceduresLimit: row.recentProceduresLimit };
    },

    async save(settings, at, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return false;
        const values = { footerHidden: settings.footerHidden, recentProceduresLimit: settings.recentProceduresLimit, updatedAt: at, updatedByUserId: actor.userId };
        tx.insert(instanceSettings)
          .values({ id: 1, ...values })
          .onConflictDoUpdate({ target: instanceSettings.id, set: values })
          .run();
        recordSecurityEvent(tx, {
          type: 'INSTANCE_SETTINGS_CHANGED',
          actor,
          subjectType: 'instance',
          subjectId: 'settings',
          occurredAt: at,
          metadata: { footerHidden: settings.footerHidden, recentProceduresLimit: settings.recentProceduresLimit },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}
