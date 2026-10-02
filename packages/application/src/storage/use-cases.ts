import { DomainValidationError, isActiveServerAdmin, parseStorageCeiling, parseStorageLimit, type StorageUsage, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { IMAGE_PENDING_MS } from '../media/use-cases.ts';
import type { Clock } from '../ports/clock.ts';
import type { StorageRepository } from '../ports/storage.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { WorkspaceNotFoundError } from '../workspaces/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface StorageDeps {
  readonly workspaces: WorkspaceRepository;
  readonly storage: StorageRepository;
  readonly clock: Clock;
}

const pendingSince = (deps: Pick<StorageDeps, 'clock'>) => new Date(deps.clock.now().getTime() - IMAGE_PENDING_MS);

/**
 * What the Workspace stores, by tool, and its limit (16.4): for Workspace admins
 * (`workspace.settings.manage`). Other members learn used and limit when an upload is refused.
 */
export async function workspaceStorage(deps: StorageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<StorageUsage> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.settings.manage');
  const usage = await deps.storage.usage(input.workspaceId, pendingSince(deps));
  if (usage === undefined) throw new WorkspaceNotFoundError();
  return usage;
}

/**
 * A Workspace admin sets the Workspace's own storage limit — at or below the ceiling the instance
 * admin set, never above — or removes it (`null`). Audited. Nothing is deleted: a limit below the
 * current usage only refuses new storage until usage is below it.
 */
export async function setWorkspaceStorageLimit(deps: StorageDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly bytes: number | null }): Promise<StorageUsage> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.settings.manage');
  const bytes = parseStorageLimit(input.bytes);
  const result = await deps.storage.setLimit({ workspaceId: input.workspaceId, bytes, at: deps.clock.now() }, userActor(input.actor), { actorMay: (role) => roleHasCapability(role, 'workspace.settings.manage') });
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'above_ceiling') throw new DomainValidationError('limit', 'storage_limit_above_ceiling', 'The limit cannot be higher than the ceiling set by the server admin');
  return workspaceStorage(deps, input);
}

/** Server admin: every Workspace with its storage by tool, its ceiling and its own limit. */
export async function listWorkspaceStorage(deps: Pick<StorageDeps, 'storage' | 'clock'>, input: { readonly actor: User }) {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.storage.list(pendingSince(deps));
}

/**
 * Server admin: the storage ceiling of a Workspace (100 MB to 1000 GB). A usage limit — no disk space
 * is reserved, and lowering it deletes nothing. Recorded in the security log.
 */
export async function setWorkspaceStorageCeiling(deps: Pick<StorageDeps, 'storage' | 'clock'>, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly bytes: number }): Promise<void> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  const result = await deps.storage.setCeiling({ workspaceId: input.workspaceId, bytes: parseStorageCeiling(input.bytes), at: deps.clock.now() }, userActor(input.actor));
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'not_found') throw new WorkspaceNotFoundError();
}
