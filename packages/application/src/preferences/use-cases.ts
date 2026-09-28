import { DEFAULT_PREFERENCES, canAuthenticate, type User, type UserPreferences } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { PreferencesRepository } from '../ports/preferences-repository.ts';

export interface PreferencesDeps {
  readonly preferences: PreferencesRepository;
  readonly clock: Clock;
}

/** The signed-in user's own presentation preferences (defaults when never changed). */
export async function getPreferences(deps: PreferencesDeps, input: { readonly user: User }): Promise<UserPreferences> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  return (await deps.preferences.find(input.user.id)) ?? DEFAULT_PREFERENCES;
}

/** Changes some of the user's own preferences; values are validated by the caller's schema and the DB. */
export async function updatePreferences(
  deps: PreferencesDeps,
  input: { readonly user: User; readonly changes: Partial<UserPreferences> },
): Promise<UserPreferences> {
  const next = { ...(await getPreferences(deps, input)), ...input.changes };
  await deps.preferences.save(input.user.id, next, deps.clock.now());
  return next;
}
