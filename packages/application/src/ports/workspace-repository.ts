import type {
  Actor,
  Membership,
  NormalizedEmail,
  UserId,
  UserStatus,
  Workspace,
  WorkspaceId,
  WorkspaceRole,
} from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

export interface WorkspaceMember {
  readonly userId: UserId;
  readonly displayName: string;
  readonly email: NormalizedEmail;
  readonly status: UserStatus;
  readonly role: WorkspaceRole;
  readonly memberSince: Date;
}

export interface MembershipGuard extends ActorGuard {
  /** After the change, at least one ACTIVE member must hold one of these roles. */
  readonly managingRoles: readonly WorkspaceRole[];
}

export type MembershipChangeResult = 'ok' | 'forbidden' | 'member_not_found' | 'already_member' | 'last_manager';

/**
 * Every mutating method commits its state change together with the matching security event
 * (WORKSPACE_CREATED / _RENAMED, MEMBERSHIP_ADDED / _ROLE_CHANGED / _REMOVED) in one transaction.
 * Nothing is written unless the result is 'ok'.
 */
export interface WorkspaceRepository {
  /** Creates the Workspace and the creator's Membership. */
  create(
    input: { readonly name: string; readonly creatorId: UserId; readonly creatorRole: WorkspaceRole; readonly at: Date },
    actor: Actor,
  ): Promise<Workspace>;
  findById(id: WorkspaceId): Promise<Workspace | undefined>;
  findMembership(workspaceId: WorkspaceId, userId: UserId): Promise<Membership | undefined>;
  /** Workspaces the user is a member of, with the user's role, ordered by name. */
  listForUser(userId: UserId): Promise<{ workspace: Workspace; role: WorkspaceRole }[]>;
  listMembers(workspaceId: WorkspaceId): Promise<WorkspaceMember[]>;
  rename(
    input: { readonly workspaceId: WorkspaceId; readonly name: string; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: MembershipGuard,
  ): Promise<'ok' | 'forbidden'>;
  addMember(
    input: { readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly role: WorkspaceRole; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: MembershipGuard,
  ): Promise<MembershipChangeResult>;
  changeRole(
    input: { readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly role: WorkspaceRole; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: MembershipGuard,
  ): Promise<MembershipChangeResult>;
  removeMember(
    input: { readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: MembershipGuard,
  ): Promise<MembershipChangeResult>;
}
