import { and, eq } from 'drizzle-orm';
import { NotAuthorizedError, type PreferencesRepository } from '@vergissmeinnicht/application';
import { DEFAULT_GUIDE_PREFERENCES, mergeGuidePreferences, type GuidePreferences, type ThemePreference, type UserId, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { IMMEDIATE, type Transaction as Tx } from './actor-guard.ts';
import { memberships, userPreferences, users, userWorkspacePreferences } from './schema.ts';


/** The account is ACTIVE and currently a member of the Workspace (rechecked inside each write). */
function activeMember(tx: Tx, userId: UserId, workspaceId: WorkspaceId): boolean {
  return (
    tx
      .select({ id: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), eq(users.status, 'ACTIVE')))
      .get() !== undefined
  );
}

/** Writes one row, or deletes it when it would change nothing (no theme, not the default, no Guide choices). */
function store(tx: Tx, userId: UserId, workspaceId: WorkspaceId, row: { theme: ThemePreference | null; isDefault: boolean; guide: GuidePreferences | null }, at: Date): void {
  const key = and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.workspaceId, workspaceId));
  if (row.theme === null && !row.isDefault && row.guide === null) {
    tx.delete(userWorkspacePreferences).where(key).run();
    return;
  }
  tx.insert(userWorkspacePreferences)
    .values({ userId, workspaceId, theme: row.theme, isDefault: row.isDefault, guide: row.guide, updatedAt: at })
    .onConflictDoUpdate({ target: [userWorkspacePreferences.userId, userWorkspacePreferences.workspaceId], set: { theme: row.theme, isDefault: row.isDefault, guide: row.guide, updatedAt: at } })
    .run();
}

export function createPreferencesRepository({ db }: Pick<AppDatabase, 'db'>): PreferencesRepository {
  const current = (tx: Tx, userId: UserId, workspaceId: WorkspaceId) =>
    tx
      .select({ theme: userWorkspacePreferences.theme, isDefault: userWorkspacePreferences.isDefault, guide: userWorkspacePreferences.guide })
      .from(userWorkspacePreferences)
      .where(and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.workspaceId, workspaceId)))
      .get() ?? { theme: null, isDefault: false, guide: null };

  return {
    async find(userId) {
      const row = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
      return row && { theme: row.theme, criticalConfirm: row.criticalConfirm, navigationOrder: row.navigationOrder, privateGamification: row.privateGamification };
    },

    async save(userId, preferences, at) {
      db.transaction((tx) => {
        if (!tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'))).get()) throw new NotAuthorizedError();
        tx.insert(userPreferences)
        .values({ userId, ...preferences, updatedAt: at })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { ...preferences, updatedAt: at } })
        .run();
      }, IMMEDIATE);
    },

    async workspacePreferences(userId) {
      // Joined with current memberships: a Workspace the person left (or was removed from) is never listed.
      const rows = db
        .select({ workspaceId: userWorkspacePreferences.workspaceId, theme: userWorkspacePreferences.theme, isDefault: userWorkspacePreferences.isDefault, guide: userWorkspacePreferences.guide })
        .from(userWorkspacePreferences)
        .innerJoin(memberships, and(eq(memberships.workspaceId, userWorkspacePreferences.workspaceId), eq(memberships.userId, userWorkspacePreferences.userId)))
        .where(eq(userWorkspacePreferences.userId, userId))
        .all();
      const themes: Record<string, ThemePreference> = {};
      const guides: Record<string, GuidePreferences> = {};
      let defaultWorkspaceId: string | null = null;
      for (const row of rows) {
        if (row.theme !== null) themes[row.workspaceId] = row.theme;
        if (row.guide !== null) guides[row.workspaceId] = row.guide;
        if (row.isDefault) defaultWorkspaceId = row.workspaceId;
      }
      return { defaultWorkspaceId, themes, guides };
    },

    async setWorkspaceTheme({ userId, workspaceId, theme, at }) {
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return false;
        store(tx, userId, workspaceId, { ...current(tx, userId, workspaceId), theme }, at);
        return true;
      }, IMMEDIATE);
    },

    async setWorkspaceGuide({ userId, workspaceId, changes, at }) {
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return false;
        const row = current(tx, userId, workspaceId);
        // A partial change keeps the stored (or default) value of every key it does not name; null clears the choices.
        const guide = changes === null ? null : mergeGuidePreferences(row.guide ?? DEFAULT_GUIDE_PREFERENCES, changes);
        store(tx, userId, workspaceId, { ...row, guide }, at);
        return true;
      }, IMMEDIATE);
    },

    async setDefaultWorkspace({ userId, workspaceId, at }) {
      return db.transaction((tx) => {
        if (workspaceId !== null && !activeMember(tx, userId, workspaceId)) return false;
        // Clear the previous default (rows of other Workspaces only change their flag).
        const previous = tx
          .select({ workspaceId: userWorkspacePreferences.workspaceId, theme: userWorkspacePreferences.theme, guide: userWorkspacePreferences.guide })
          .from(userWorkspacePreferences)
          .where(and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.isDefault, true)))
          .all();
        for (const row of previous) store(tx, userId, row.workspaceId as WorkspaceId, { theme: row.theme, isDefault: false, guide: row.guide }, at);
        if (workspaceId !== null) store(tx, userId, workspaceId, { ...current(tx, userId, workspaceId), isDefault: true }, at);
        return true;
      }, IMMEDIATE);
    },
  };
}
