// Centralized capability policies. Authorization is always evaluated server-side, inside the
// application use-cases; callers never compare role strings themselves.
import { WORKSPACE_ROLES, isActiveServerAdmin, type User, type WorkspaceRole } from '@vergissmeinnicht/domain';

/**
 * Capabilities a Workspace role can grant. Procedure/Run capabilities are added with the features
 * that need them (Steps 3.2, 4, 5); every new capability must be assigned here and nowhere else.
 */
export const WORKSPACE_CAPABILITIES = [
  /** See the Workspace itself (name, own role). */
  'workspace.view',
  /** See who else is a member and their role. */
  'workspace.members.view',
  /** Add members, change roles, remove members. */
  'workspace.members.manage',
  /** Rename the Workspace. */
  'workspace.settings.manage',
] as const;
export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

const GUEST: readonly WorkspaceCapability[] = ['workspace.view'];
const USER: readonly WorkspaceCapability[] = [...GUEST, 'workspace.members.view'];
const EDITOR: readonly WorkspaceCapability[] = [...USER];
const ADMIN: readonly WorkspaceCapability[] = [...EDITOR, 'workspace.members.manage', 'workspace.settings.manage'];

const ROLE_CAPABILITIES: Readonly<Record<WorkspaceRole, ReadonlySet<WorkspaceCapability>>> = Object.freeze({
  GUEST: new Set(GUEST),
  USER: new Set(USER),
  EDITOR: new Set(EDITOR),
  ADMIN: new Set(ADMIN),
});

export function roleHasCapability(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

/** Capabilities of a role, in declaration order (for clients that adapt their UI; never a security boundary). */
export function capabilitiesOf(role: WorkspaceRole): WorkspaceCapability[] {
  return WORKSPACE_CAPABILITIES.filter((capability) => roleHasCapability(role, capability));
}

/**
 * Who may create Workspaces. Decided 2026-09-26: ACTIVE server admins only. A later admin-board
 * setting that also allows other users changes this function, not its callers.
 */
export function canCreateWorkspace(user: Pick<User, 'status' | 'serverAdmin'>): boolean {
  return isActiveServerAdmin(user);
}

/** Roles granting a capability, e.g. to keep at least one member able to manage the Workspace. */
export function rolesWithCapability(capability: WorkspaceCapability): WorkspaceRole[] {
  return WORKSPACE_ROLES.filter((role) => roleHasCapability(role, capability));
}
