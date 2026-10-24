import { canAuthenticate, type User, type UserId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { AvatarProcessor, AvatarRepository } from '../ports/avatars.ts';
import type { Clock } from '../ports/clock.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface AvatarDeps {
  readonly avatars: AvatarRepository;
  readonly processor: AvatarProcessor;
  readonly workspaces: WorkspaceRepository;
  readonly clock: Clock;
}

function requireActive(user: User): void {
  if (!canAuthenticate(user)) throw new NotAuthorizedError();
}

/**
 * Sets the person's own profile picture (section 29). Only the server's re-encoded JPEG is kept — never
 * the upload — so EXIF, GPS, comments and anything appended to the file are gone. Returns the version.
 */
export async function uploadAvatar(deps: AvatarDeps, input: { readonly user: User; readonly bytes: Uint8Array }): Promise<string> {
  requireActive(input.user);
  const jpeg = await deps.processor.avatar(input.bytes);
  const version = await deps.avatars.save({ userId: input.user.id, jpeg, at: deps.clock.now() });
  if (version === undefined) throw new NotAuthorizedError();
  return version;
}

export async function removeAvatar(deps: Pick<AvatarDeps, 'avatars'>, input: { readonly user: User }): Promise<void> {
  requireActive(input.user);
  await deps.avatars.remove(input.user.id);
}

/** The person's own picture version, or null. */
export async function ownAvatarVersion(deps: Pick<AvatarDeps, 'avatars'>, input: { readonly user: User }): Promise<string | null> {
  if (!canAuthenticate(input.user)) return null;
  return (await deps.avatars.versions([input.user.id])).get(input.user.id) ?? null;
}

export async function readOwnAvatar(deps: Pick<AvatarDeps, 'avatars'>, input: { readonly user: User }): Promise<Uint8Array> {
  requireActive(input.user);
  const found = await deps.avatars.find(input.user.id);
  if (found === undefined) throw new AvatarNotFoundError();
  return found.jpeg;
}

/**
 * Another member's picture: only for people who may see the Workspace's members
 * (`workspace.members.view`), and only of a current, ACTIVE member of that Workspace.
 */
export async function readMemberAvatar(
  deps: Pick<AvatarDeps, 'avatars' | 'workspaces'>,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly userId: UserId },
): Promise<Uint8Array> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.members.view', null);
  const jpeg = await deps.avatars.findMember(input.workspaceId, input.userId);
  if (jpeg === undefined) throw new AvatarNotFoundError();
  return jpeg;
}

/** No picture (or none the caller may see) — the same answer either way. */
export class AvatarNotFoundError extends Error {
  constructor() {
    super('Avatar not found');
    this.name = 'AvatarNotFoundError';
  }
}
