import type { UserId, UserPreferences } from '@vergissmeinnicht/domain';

export interface PreferencesRepository {
  /** Stored preferences, or undefined when the user never changed them. */
  find(userId: UserId): Promise<UserPreferences | undefined>;
  save(userId: UserId, preferences: UserPreferences, at: Date): Promise<void>;
}
