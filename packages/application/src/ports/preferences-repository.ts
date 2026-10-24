import type { ThemePreference, UserId, UserPreferences, WorkspaceId, WorkspacePreferences } from '@vergissmeinnicht/domain';

export interface PreferencesRepository {
  /** Stored preferences, or undefined when the user never changed them. */
  find(userId: UserId): Promise<UserPreferences | undefined>;
  save(userId: UserId, preferences: UserPreferences, at: Date): Promise<void>;
  /** The person's per-Workspace choices, limited to Workspaces they are a member of now (section 28). */
  workspacePreferences(userId: UserId): Promise<WorkspacePreferences>;
  /**
   * Sets (or with `null` clears) the person's theme for one Workspace. Rechecks, in the same
   * transaction, that the account is ACTIVE and a member; false (nothing written) otherwise.
   */
  setWorkspaceTheme(input: { readonly userId: UserId; readonly workspaceId: WorkspaceId; readonly theme: ThemePreference | null; readonly at: Date }): Promise<boolean>;
  /** Makes one Workspace (membership rechecked as above) the person's default, or clears it with `null`. */
  setDefaultWorkspace(input: { readonly userId: UserId; readonly workspaceId: WorkspaceId | null; readonly at: Date }): Promise<boolean>;
}
