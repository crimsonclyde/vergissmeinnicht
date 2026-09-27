import {
  canAuthenticate,
  type Actor,
  type Membership,
  type NormalizedEmail,
  normalizeWorkspaceName,
  type User,
  type UserId,
  type Workspace,
  type WorkspaceId,
  type WorkspaceRole,
} from '@vergissmeinnicht/domain';
import {
  canCreateWorkspace,
  capabilitiesOf,
  roleHasCapability,
  rolesWithCapability,
  type WorkspaceCapability,
} from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { UserRepository } from '../ports/user-repository.ts';
import type {
  MembershipChangeResult,
  MembershipGuard,
  WorkspaceMember,
  WorkspaceRepository,
} from '../ports/workspace-repository.ts';
import { UnknownAccountError } from '../recovery/errors.ts';
import {
  AlreadyMemberError,
  LastWorkspaceAdminError,
  MemberNotFoundError,
  WorkspaceNotFoundError,
} from './errors.ts';

export interface WorkspaceDeps {
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: Clock;
}

/** The creator must be able to manage the new Workspace. */
const CREATOR_ROLE: WorkspaceRole = 'ADMIN';

function userActor(user: User): Actor & { kind: 'user' } {
  return { kind: 'user', userId: user.id, displayName: user.displayName };
}

/**
 * The single entry point for Workspace-scoped authorization: the actor must be ACTIVE and a member
 * (otherwise WorkspaceNotFoundError, indistinguishable from an unknown id), and the member's role
 * must grant `capability` (otherwise NotAuthorizedError). Membership is read on every call, so
 * removal or demotion takes effect on the next request.
 */
export async function authorizeWorkspace(
  deps: Pick<WorkspaceDeps, 'workspaces'>,
  actor: User,
  workspaceId: WorkspaceId,
  capability: WorkspaceCapability,
): Promise<Membership> {
  const membership = canAuthenticate(actor) ? await deps.workspaces.findMembership(workspaceId, actor.id) : undefined;
  if (membership === undefined) throw new WorkspaceNotFoundError();
  if (!roleHasCapability(membership.role, capability)) throw new NotAuthorizedError();
  return membership;
}

function guardFor(capability: WorkspaceCapability): MembershipGuard {
  return {
    actorMay: (role) => roleHasCapability(role, capability),
    managingRoles: rolesWithCapability('workspace.members.manage'),
  };
}

function throwUnlessOk(result: MembershipChangeResult): void {
  switch (result) {
    case 'ok':
      return;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'member_not_found':
      throw new MemberNotFoundError();
    case 'already_member':
      throw new AlreadyMemberError();
    case 'last_manager':
      throw new LastWorkspaceAdminError();
  }
}

export async function createWorkspace(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly name: string },
): Promise<Workspace> {
  if (!canCreateWorkspace(input.actor)) throw new NotAuthorizedError();
  const name = normalizeWorkspaceName(input.name);
  return deps.workspaces.create(
    { name, creatorId: input.actor.id, creatorRole: CREATOR_ROLE, at: deps.clock.now() },
    userActor(input.actor),
  );
}

/** Only the caller's own Workspaces; there is no listing of other Workspaces. */
export async function listMyWorkspaces(
  deps: WorkspaceDeps,
  input: { readonly actor: User },
): Promise<{ workspace: Workspace; role: WorkspaceRole }[]> {
  if (!canAuthenticate(input.actor)) return [];
  return deps.workspaces.listForUser(input.actor.id);
}

export async function getWorkspace(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId },
): Promise<{ workspace: Workspace; role: WorkspaceRole; capabilities: WorkspaceCapability[] }> {
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const workspace = await deps.workspaces.findById(input.workspaceId);
  if (workspace === undefined) throw new WorkspaceNotFoundError();
  return { workspace, role: membership.role, capabilities: capabilitiesOf(membership.role) };
}

export type VisibleMember = Omit<WorkspaceMember, 'email' | 'status'> & {
  /** Only for callers who manage members; other members see names and roles only. */
  readonly email: NormalizedEmail | undefined;
  readonly status: WorkspaceMember['status'] | undefined;
};

export async function listMembers(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId },
): Promise<VisibleMember[]> {
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.members.view');
  const showContact = roleHasCapability(membership.role, 'workspace.members.manage');
  const members = await deps.workspaces.listMembers(input.workspaceId);
  return members.map((member) => ({
    ...member,
    email: showContact ? member.email : undefined,
    status: showContact ? member.status : undefined,
  }));
}

export async function renameWorkspace(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly name: string },
): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.settings.manage');
  const name = normalizeWorkspaceName(input.name);
  const result = await deps.workspaces.rename(
    { workspaceId: input.workspaceId, name, at: deps.clock.now() },
    userActor(input.actor),
    guardFor('workspace.settings.manage'),
  );
  throwUnlessOk(result);
}

/**
 * Adds an existing ACTIVE account. Unknown and disabled accounts are reported the same way.
 * New people are invited by a server admin first (invitations are server-wide).
 */
export async function addMember(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly email: NormalizedEmail; readonly role: WorkspaceRole },
): Promise<WorkspaceMember> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.members.manage');
  const target = await deps.users.findByEmail(input.email);
  if (target === undefined || !canAuthenticate(target)) throw new UnknownAccountError();
  const at = deps.clock.now();
  throwUnlessOk(
    await deps.workspaces.addMember(
      { workspaceId: input.workspaceId, userId: target.id, role: input.role, at },
      userActor(input.actor),
      guardFor('workspace.members.manage'),
    ),
  );
  return {
    userId: target.id,
    displayName: target.displayName,
    email: target.email,
    status: target.status,
    role: input.role,
    memberSince: at,
  };
}

/** Admins may change any role, including their own, as long as an ACTIVE admin remains. */
export async function changeMemberRole(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly role: WorkspaceRole },
): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.members.manage');
  throwUnlessOk(
    await deps.workspaces.changeRole(
      { workspaceId: input.workspaceId, userId: input.userId, role: input.role, at: deps.clock.now() },
      userActor(input.actor),
      guardFor('workspace.members.manage'),
    ),
  );
}

/** Removal takes effect on the member's next request: every authorization re-reads the Membership. */
export async function removeMember(
  deps: WorkspaceDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly userId: UserId },
): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.members.manage');
  throwUnlessOk(
    await deps.workspaces.removeMember(
      { workspaceId: input.workspaceId, userId: input.userId, at: deps.clock.now() },
      userActor(input.actor),
      guardFor('workspace.members.manage'),
    ),
  );
}
