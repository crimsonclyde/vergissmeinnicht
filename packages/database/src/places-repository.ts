import { and, eq } from 'drizzle-orm';
import type { PlacesRepository } from '@vergissmeinnicht/application';
import { normalizePlacePreferences, type UserId, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { IMMEDIATE, type Transaction as Tx } from './actor-guard.ts';
import { memberships, userPlaceBackgrounds, userPlacePreferences, users } from './schema.ts';

const versionOf = (at: Date) => String(at.getTime());

/** The account is ACTIVE and currently a member of the Workspace. */
function activeMember(tx: Pick<Tx, 'select'>, userId: UserId, workspaceId: WorkspaceId): boolean {
  return (
    tx
      .select({ id: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), eq(users.status, 'ACTIVE')))
      .get() !== undefined
  );
}

/**
 * Places (section 30): one person's own settings and photo per Workspace. Every read and write is
 * keyed by both ids and requires a current membership of an ACTIVE account, so nothing leaks across
 * Workspaces or accounts, and a former member's rows are never served (they are also deleted when the
 * membership is removed).
 */
export function createPlacesRepository({ db }: Pick<AppDatabase, 'db'>): PlacesRepository {
  const settingsKey = (userId: UserId, workspaceId: WorkspaceId) => and(eq(userPlacePreferences.userId, userId), eq(userPlacePreferences.workspaceId, workspaceId));
  const photoKey = (userId: UserId, workspaceId: WorkspaceId) => and(eq(userPlaceBackgrounds.userId, userId), eq(userPlaceBackgrounds.workspaceId, workspaceId));

  return {
    async find(userId, workspaceId) {
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return undefined;
        const settings = tx.select({ settings: userPlacePreferences.settings }).from(userPlacePreferences).where(settingsKey(userId, workspaceId)).get();
        const photo = tx
          .select({ width: userPlaceBackgrounds.width, height: userPlaceBackgrounds.height, updatedAt: userPlaceBackgrounds.updatedAt })
          .from(userPlaceBackgrounds)
          .where(photoKey(userId, workspaceId))
          .get();
        let stored: unknown = null;
        try {
          stored = settings === undefined ? null : JSON.parse(settings.settings);
        } catch {
          stored = null;
        }
        return {
          // Tolerant: a value saved by a later version keeps every field this version understands.
          preferences: normalizePlacePreferences(stored),
          photo: photo === undefined ? null : { version: versionOf(photo.updatedAt), width: photo.width, height: photo.height },
        };
      });
    },

    async saveSettings({ userId, workspaceId, preferences, at }) {
      const settings = JSON.stringify(preferences);
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return false;
        tx.insert(userPlacePreferences)
          .values({ userId, workspaceId, settings, updatedAt: at })
          .onConflictDoUpdate({ target: [userPlacePreferences.userId, userPlacePreferences.workspaceId], set: { settings, updatedAt: at } })
          .run();
        return true;
      }, IMMEDIATE);
    },

    async reset(userId, workspaceId) {
      db.transaction((tx) => {
        tx.delete(userPlacePreferences).where(settingsKey(userId, workspaceId)).run();
        tx.delete(userPlaceBackgrounds).where(photoKey(userId, workspaceId)).run();
      }, IMMEDIATE);
    },

    async savePhoto({ userId, workspaceId, jpeg, width, height, at }) {
      const bytes = Buffer.from(jpeg);
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return undefined;
        tx.insert(userPlaceBackgrounds)
          .values({ userId, workspaceId, jpeg: bytes, width, height, updatedAt: at })
          .onConflictDoUpdate({ target: [userPlaceBackgrounds.userId, userPlaceBackgrounds.workspaceId], set: { jpeg: bytes, width, height, updatedAt: at } })
          .run();
        return versionOf(at);
      }, IMMEDIATE);
    },

    async removePhoto(userId, workspaceId) {
      db.delete(userPlaceBackgrounds).where(photoKey(userId, workspaceId)).run();
    },

    async readPhoto(userId, workspaceId) {
      const row = db
        .select({ jpeg: userPlaceBackgrounds.jpeg })
        .from(userPlaceBackgrounds)
        .innerJoin(memberships, and(eq(memberships.userId, userPlaceBackgrounds.userId), eq(memberships.workspaceId, userPlaceBackgrounds.workspaceId)))
        .innerJoin(users, eq(users.id, userPlaceBackgrounds.userId))
        .where(and(photoKey(userId, workspaceId), eq(users.status, 'ACTIVE')))
        .get();
      return row && new Uint8Array(row.jpeg);
    },
  };
}
