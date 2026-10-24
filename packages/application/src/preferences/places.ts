import { DEFAULT_PLACE_PREFERENCES, parsePlacePreferences, type PlaceSettings, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { PlaceBackgroundProcessor, PlacesRepository } from '../ports/places.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { WorkspaceNotFoundError } from '../workspaces/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface PlacesDeps {
  readonly places: PlacesRepository;
  readonly processor: PlaceBackgroundProcessor;
  readonly workspaces: WorkspaceRepository;
  readonly clock: Clock;
}

/** No background photo (or none the caller may see): the same answer either way. */
export class PlaceBackgroundNotFoundError extends Error {
  constructor() {
    super('Place background not found');
    this.name = 'PlaceBackgroundNotFoundError';
  }
}

const EMPTY: PlaceSettings = Object.freeze({ preferences: DEFAULT_PLACE_PREFERENCES, photo: null });

/**
 * Places (section 30): the signed-in person's own look of one Workspace they belong to — any role,
 * also GUEST, since it changes only their own view. Never the Workspace's theme or country, never
 * anyone else's settings: the user id always comes from the session. Unknown or foreign Workspaces
 * answer as unknown.
 */
async function authorize(deps: Pick<PlacesDeps, 'workspaces'>, user: User, workspaceId: WorkspaceId): Promise<void> {
  await authorizeWorkspace(deps, user, workspaceId, 'workspace.view', null);
}

export async function getPlaceSettings(deps: Pick<PlacesDeps, 'places' | 'workspaces'>, input: { readonly user: User; readonly workspaceId: WorkspaceId }): Promise<PlaceSettings> {
  await authorize(deps, input.user, input.workspaceId);
  return (await deps.places.find(input.user.id, input.workspaceId)) ?? EMPTY;
}

/** Saves after strict validation; the previous settings stay when anything is invalid. */
export async function savePlaceSettings(
  deps: Pick<PlacesDeps, 'places' | 'workspaces' | 'clock'>,
  input: { readonly user: User; readonly workspaceId: WorkspaceId; readonly preferences: unknown },
): Promise<PlaceSettings> {
  await authorize(deps, input.user, input.workspaceId);
  const preferences = parsePlacePreferences(input.preferences);
  if (!(await deps.places.saveSettings({ userId: input.user.id, workspaceId: input.workspaceId, preferences, at: deps.clock.now() }))) throw new WorkspaceNotFoundError();
  return getPlaceSettings(deps, input);
}

/** "Restore Places defaults": only this person's settings and photo for this Workspace. */
export async function resetPlaceSettings(deps: Pick<PlacesDeps, 'places' | 'workspaces'>, input: { readonly user: User; readonly workspaceId: WorkspaceId }): Promise<PlaceSettings> {
  await authorize(deps, input.user, input.workspaceId);
  await deps.places.reset(input.user.id, input.workspaceId);
  return EMPTY;
}

/**
 * Sets the person's own background photo for this Workspace. Only the server's re-encoded JPEG is
 * kept — never the upload — so EXIF, GPS and anything appended to the file are gone. On any refusal
 * the previous photo and settings stay as they were.
 */
export async function uploadPlaceBackground(deps: PlacesDeps, input: { readonly user: User; readonly workspaceId: WorkspaceId; readonly bytes: Uint8Array }): Promise<PlaceSettings> {
  await authorize(deps, input.user, input.workspaceId);
  const image = await deps.processor.background(input.bytes);
  const version = await deps.places.savePhoto({ userId: input.user.id, workspaceId: input.workspaceId, ...image, at: deps.clock.now() });
  if (version === undefined) throw new WorkspaceNotFoundError();
  return getPlaceSettings(deps, input);
}

export async function removePlaceBackground(deps: Pick<PlacesDeps, 'places' | 'workspaces'>, input: { readonly user: User; readonly workspaceId: WorkspaceId }): Promise<PlaceSettings> {
  await authorize(deps, input.user, input.workspaceId);
  await deps.places.removePhoto(input.user.id, input.workspaceId);
  return getPlaceSettings(deps, input);
}

/** The person's own photo — there is no way to read anyone else's. */
export async function readPlaceBackground(deps: Pick<PlacesDeps, 'places' | 'workspaces'>, input: { readonly user: User; readonly workspaceId: WorkspaceId }): Promise<Uint8Array> {
  await authorize(deps, input.user, input.workspaceId);
  const jpeg = await deps.places.readPhoto(input.user.id, input.workspaceId);
  if (jpeg === undefined) throw new PlaceBackgroundNotFoundError();
  return jpeg;
}
