import type { PlaceSettings, PlacePreferences, UserId, WorkspaceId } from '@vergissmeinnicht/domain';

/**
 * Validates an uploaded Places background like an instruction image (content-identified JPEG/PNG/WebP,
 * no HEIC, animation or pixel bombs; orientation applied, every metadata block dropped) and returns a
 * JPEG of at most `PLACE_BACKGROUND_EDGE` px (never enlarged) within `MAX_STORED_PLACE_BACKGROUND_BYTES`.
 * Throws `ImageRejectedError`.
 */
export interface PlaceBackgroundProcessor {
  background(input: Uint8Array): Promise<{ readonly jpeg: Uint8Array; readonly width: number; readonly height: number }>;
}

/**
 * A person's own Places look per Workspace (section 30). Every method acts on one (person, Workspace)
 * pair; reads return nothing unless the person is a current member with an ACTIVE account, and writes
 * recheck that in the same transaction (false or undefined = nothing written).
 */
export interface PlacesRepository {
  find(userId: UserId, workspaceId: WorkspaceId): Promise<PlaceSettings | undefined>;
  saveSettings(input: { readonly userId: UserId; readonly workspaceId: WorkspaceId; readonly preferences: PlacePreferences; readonly at: Date }): Promise<boolean>;
  /** Removes the settings and the photo of this person in this Workspace. */
  reset(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  /** Saves (replaces) the photo; returns its version. */
  savePhoto(input: { readonly userId: UserId; readonly workspaceId: WorkspaceId; readonly jpeg: Uint8Array; readonly width: number; readonly height: number; readonly at: Date }): Promise<string | undefined>;
  removePhoto(userId: UserId, workspaceId: WorkspaceId): Promise<void>;
  readPhoto(userId: UserId, workspaceId: WorkspaceId): Promise<Uint8Array | undefined>;
}
