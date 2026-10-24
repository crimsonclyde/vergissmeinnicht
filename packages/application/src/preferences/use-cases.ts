import {
  DEFAULT_PREFERENCES,
  canAuthenticate,
  type ThemePreference,
  type User,
  type UserPreferences,
  type WorkspaceId,
  type WorkspacePreferences,
} from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { PreferencesRepository } from '../ports/preferences-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { WorkspaceNotFoundError } from '../workspaces/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface PreferencesDeps {
  readonly preferences: PreferencesRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: Clock;
}

/** The signed-in user's own presentation preferences (defaults when never changed). */
export async function getPreferences(deps: Pick<PreferencesDeps, 'preferences'>, input: { readonly user: User }): Promise<UserPreferences> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  return (await deps.preferences.find(input.user.id)) ?? DEFAULT_PREFERENCES;
}

/** Changes some of the user's own preferences; values are validated by the caller's schema and the DB. */
export async function updatePreferences(
  deps: Pick<PreferencesDeps, 'preferences' | 'clock'>,
  input: { readonly user: User; readonly changes: Partial<UserPreferences> },
): Promise<UserPreferences> {
  const next = { ...(await getPreferences(deps, input)), ...input.changes };
  await deps.preferences.save(input.user.id, next, deps.clock.now());
  return next;
}

/** The person's default Workspace and per-Workspace themes (section 28); only current memberships. */
export async function getWorkspacePreferences(deps: Pick<PreferencesDeps, 'preferences'>, input: { readonly user: User }): Promise<WorkspacePreferences> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  return deps.preferences.workspacePreferences(input.user.id);
}

/**
 * Sets the person's theme for a Workspace they belong to (any role, also GUEST: it changes only their
 * own view). `null` returns that Workspace to the default theme. A Workspace they do not belong to
 * answers as unknown.
 */
export async function setWorkspaceTheme(
  deps: PreferencesDeps,
  input: { readonly user: User; readonly workspaceId: WorkspaceId; readonly theme: ThemePreference | null },
): Promise<WorkspacePreferences> {
  await authorizeWorkspace(deps, input.user, input.workspaceId, 'workspace.view', null);
  const saved = await deps.preferences.setWorkspaceTheme({ userId: input.user.id, workspaceId: input.workspaceId, theme: input.theme, at: deps.clock.now() });
  if (!saved) throw new WorkspaceNotFoundError();
  return deps.preferences.workspacePreferences(input.user.id);
}

/** Chooses the Workspace that opens first (a Workspace the person belongs to), or clears the choice. */
export async function setDefaultWorkspace(
  deps: PreferencesDeps,
  input: { readonly user: User; readonly workspaceId: WorkspaceId | null },
): Promise<WorkspacePreferences> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  if (input.workspaceId !== null) await authorizeWorkspace(deps, input.user, input.workspaceId, 'workspace.view', null);
  const saved = await deps.preferences.setDefaultWorkspace({ userId: input.user.id, workspaceId: input.workspaceId, at: deps.clock.now() });
  if (!saved) throw new WorkspaceNotFoundError();
  return deps.preferences.workspacePreferences(input.user.id);
}
