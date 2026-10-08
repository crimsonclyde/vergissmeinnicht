import { DEFAULT_INSTANCE_SETTINGS, type InstanceSettingsRepository } from '@vergissmeinnicht/application';
import { DOCUMENT_FILE_FORMATS, type DocumentFileFormat } from '@vergissmeinnicht/domain';
import { eq } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { instanceSettings, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

/** Stored comma-separated; anything unknown in the column is ignored (the list can never be widened). */
const formatsOf = (stored: string): DocumentFileFormat[] => DOCUMENT_FILE_FORMATS.filter((format) => stored.split(',').includes(format));

export function createInstanceSettingsRepository({ db }: Pick<AppDatabase, 'db'>): InstanceSettingsRepository {
  return {
    async get() {
      const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).get();
      if (row === undefined) return DEFAULT_INSTANCE_SETTINGS;
      return {
        footerHidden: row.footerHidden,
        recentProceduresLimit: row.recentProceduresLimit,
        documentMaxFileBytes: row.documentMaxFileBytes,
        documentFormats: formatsOf(row.documentFormats),
        workspaceRestoreMaxBytes: row.workspaceRestoreMaxBytes,
      };
    },

    async save(settings, at, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return false;
        const values = {
          footerHidden: settings.footerHidden,
          recentProceduresLimit: settings.recentProceduresLimit,
          documentMaxFileBytes: settings.documentMaxFileBytes,
          documentFormats: settings.documentFormats.join(','),
          workspaceRestoreMaxBytes: settings.workspaceRestoreMaxBytes,
          updatedAt: at,
          updatedByUserId: actor.userId,
        };
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
          metadata: {
            footerHidden: settings.footerHidden,
            recentProceduresLimit: settings.recentProceduresLimit,
            documentMaxFileBytes: settings.documentMaxFileBytes,
            documentFormats: settings.documentFormats.join(','),
            workspaceRestoreMaxBytes: settings.workspaceRestoreMaxBytes,
          },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}
