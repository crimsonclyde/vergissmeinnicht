import { and, eq } from 'drizzle-orm';
import { NotAuthorizedError, type PreferencesRepository } from '@vergissmeinnicht/application';
import type { ThemePreference, UserId, WorkspaceId } from '@vergissmeinnicht/domain';
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

/** Writes one row, or deletes it when it would change nothing (no theme, not the default). */
function store(tx: Tx, userId: UserId, workspaceId: WorkspaceId, row: { theme: ThemePreference | null; isDefault: boolean }, at: Date): void {
  const key = and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.workspaceId, workspaceId));
  if (row.theme === null && !row.isDefault) {
    tx.delete(userWorkspacePreferences).where(key).run();
    return;
  }
  tx.insert(userWorkspacePreferences)
    .values({ userId, workspaceId, theme: row.theme, isDefault: row.isDefault, updatedAt: at })
    .onConflictDoUpdate({ target: [userWorkspacePreferences.userId, userWorkspacePreferences.workspaceId], set: { theme: row.theme, isDefault: row.isDefault, updatedAt: at } })
    .run();
}

export function createPreferencesRepository({ db }: Pick<AppDatabase, 'db'>): PreferencesRepository {
  const current = (tx: Tx, userId: UserId, workspaceId: WorkspaceId) =>
    tx
      .select({ theme: userWorkspacePreferences.theme, isDefault: userWorkspacePreferences.isDefault })
      .from(userWorkspacePreferences)
      .where(and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.workspaceId, workspaceId)))
      .get() ?? { theme: null, isDefault: false };

  return {
    async find(userId) {
      const row = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
      return row && { guide: row.guide, theme: row.theme, criticalConfirm: row.criticalConfirm, navigationOrder: row.navigationOrder, privateGamification: row.privateGamification };
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
        .select({ workspaceId: userWorkspacePreferences.workspaceId, theme: userWorkspacePreferences.theme, isDefault: userWorkspacePreferences.isDefault })
        .from(userWorkspacePreferences)
        .innerJoin(memberships, and(eq(memberships.workspaceId, userWorkspacePreferences.workspaceId), eq(memberships.userId, userWorkspacePreferences.userId)))
        .where(eq(userWorkspacePreferences.userId, userId))
        .all();
      const themes: Record<string, ThemePreference> = {};
      let defaultWorkspaceId: string | null = null;
      for (const row of rows) {
        if (row.theme !== null) themes[row.workspaceId] = row.theme;
        if (row.isDefault) defaultWorkspaceId = row.workspaceId;
      }
      return { defaultWorkspaceId, themes };
    },

    async setWorkspaceTheme({ userId, workspaceId, theme, at }) {
      return db.transaction((tx) => {
        if (!activeMember(tx, userId, workspaceId)) return false;
        store(tx, userId, workspaceId, { ...current(tx, userId, workspaceId), theme }, at);
        return true;
      }, IMMEDIATE);
    },

    async setDefaultWorkspace({ userId, workspaceId, at }) {
      return db.transaction((tx) => {
        if (workspaceId !== null && !activeMember(tx, userId, workspaceId)) return false;
        // Clear the previous default (rows of other Workspaces only change their flag).
        const previous = tx
          .select({ workspaceId: userWorkspacePreferences.workspaceId, theme: userWorkspacePreferences.theme })
          .from(userWorkspacePreferences)
          .where(and(eq(userWorkspacePreferences.userId, userId), eq(userWorkspacePreferences.isDefault, true)))
          .all();
        for (const row of previous) store(tx, userId, row.workspaceId as WorkspaceId, { theme: row.theme, isDefault: false }, at);
        if (workspaceId !== null) store(tx, userId, workspaceId, { ...current(tx, userId, workspaceId), isDefault: true }, at);
        return true;
      }, IMMEDIATE);
    },
  };
}
