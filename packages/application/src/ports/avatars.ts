import type { UserId, WorkspaceId } from '@vergissmeinnicht/domain';

/**
 * Validates an uploaded profile picture like an instruction image (content-identified JPEG/PNG/WebP,
 * no HEIC, animation or pixel bombs; orientation applied, every metadata block dropped) and returns a
 * square JPEG of `AVATAR_EDGE` px within `MAX_STORED_AVATAR_BYTES`. Throws `ImageRejectedError`.
 */
export interface AvatarProcessor {
  avatar(input: Uint8Array): Promise<Uint8Array>;
}

/** Profile pictures (section 29): personal data of one account, never part of a Workspace. */
export interface AvatarRepository {
  /** The person's own picture and its version (the time it was saved, ms), or undefined. */
  find(userId: UserId): Promise<{ readonly jpeg: Uint8Array; readonly version: string } | undefined>;
  /**
   * The picture of a current member of the Workspace whose account is ACTIVE — undefined for anyone
   * else (not a member, left, disabled, imported history identity, no picture).
   */
  findMember(workspaceId: WorkspaceId, userId: UserId): Promise<Uint8Array | undefined>;
  /** Versions of the given accounts' pictures (only ACTIVE accounts with one). */
  versions(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, string>>;
  /** Saves (replaces) the picture; rechecks an ACTIVE account in the same transaction. False = nothing written. */
  save(input: { readonly userId: UserId; readonly jpeg: Uint8Array; readonly at: Date }): Promise<string | undefined>;
  remove(userId: UserId): Promise<void>;
}
