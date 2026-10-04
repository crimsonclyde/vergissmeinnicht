// Centralized capability policies. Authorization is always evaluated server-side, inside the
// application use-cases; callers never compare role strings themselves.
import { WORKSPACE_ROLES, isActiveServerAdmin, type User, type WorkspaceRole, type WorkspaceTool } from '@vergissmeinnicht/domain';

/**
 * Capabilities a Workspace role can grant. Every capability is assigned here and nowhere else;
 * use-cases ask for a capability, never for a role. Changing the matrix is a security-relevant
 * change (docs/development/security.md §3) and must update the exact-matrix test.
 *
 * Procedure/Run capabilities are defined now (Step 3.2) and enforced by the use-cases that
 * introduce Procedures (Step 4) and Runs (Step 5).
 */
export const WORKSPACE_CAPABILITIES = [
  /** See the Workspace itself (name, own role) and leave it. */
  'workspace.view',
  /** See who else is a member and their role. */
  'workspace.members.view',
  /** Add members, change roles, remove members. */
  'workspace.members.manage',
  /** Rename the Workspace. */
  'workspace.settings.manage',
  /** Read non-deleted Procedures of the Workspace (Workspace-wide in V1, no per-Procedure ACLs). */
  'procedure.view',
  /** Create, edit, reorder, duplicate, import and soft-delete Procedures. */
  'procedure.edit',
  /** See soft-deleted Procedures and restore them. */
  'procedure.restore',
  /** Read Runs (active and historical) and their audit history. */
  'run.view',
  /** Start a new Run from a Procedure. */
  'run.start',
  /** Change Step states (incl. undo) and complete any active Run of the Workspace. */
  'run.execute',
  /** Abort an active Run. */
  'run.abort',
  /** Create, list and revoke Knot links to Procedures and Runs of the Workspace. */
  'knot.manage',
  /**
   * Schedule a Procedure for a date (with reminders to oneself), reschedule or cancel scheduled
   * items of the Workspace (13.4). Seeing scheduled items needs only `procedure.view`; starting one
   * additionally needs `run.start`.
   */
  'schedule.manage',
  /** Read the Lists (grocery lists) of the Workspace and their items (15.3). */
  'list.view',
  /** Create, rename, delete and restore Lists; add, edit, check and remove their items. */
  'list.edit',
  /** See Documents and their files: preview and download originals (16.1; every role, guests included — H4). */
  'document.view',
  /** Upload files and manage Documents (USER and above; a GUEST never writes). */
  'document.manage',
  /** Delete Documents and Folders for good — only out of Trash, only a Workspace admin (16.4, H11). */
  'document.purge',
  /** Remove a Document version that a **finished** Run keeps — with a reason, leaving a permanent note (16.5, P4). Workspace admins only. */
  'run.document.remove',
  /** See Contacts (16.6): every role, guests included. A Contact is not a User and grants nothing. */
  'contact.view',
  /** Create, edit, delete, restore, link and import Contacts (USER and above; a GUEST never writes). */
  'contact.manage',
  /** Export all Contacts as CSV or vCard (USER and above — third-party personal data leaves the app). */
  'contact.export',
  /** Delete Contacts for good — only out of Trash, only a Workspace admin. */
  'contact.purge',
  /** See MaintenanceRecords, costs included (16.7): every role, guests too — decided 2026-10-02 (P3, for Maintenance). */
  'maintenance.view',
  /** Create and edit MaintenanceRecords, change their status, link them, delete to Trash and restore (USER and above). */
  'maintenance.manage',
  /** Delete MaintenanceRecords for good — only out of Trash, only a Workspace admin. */
  'maintenance.purge',
  /** Switch the optional tools of the Workspace (Documents, …) on and off (16.2). */
  'workspace.tools.manage',
] as const;
export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

/** Read-only: Workspace content and history, no execution. */
const GUEST: readonly WorkspaceCapability[] = ['workspace.view', 'procedure.view', 'run.view', 'list.view', 'document.view', 'contact.view', 'maintenance.view'];
/** Executes Runs. */
const USER: readonly WorkspaceCapability[] = [...GUEST, 'workspace.members.view', 'run.start', 'run.execute', 'run.abort', 'schedule.manage', 'list.edit', 'document.manage', 'contact.manage', 'contact.export', 'maintenance.manage'];
/** Authors Procedures. */
const EDITOR: readonly WorkspaceCapability[] = [...USER, 'procedure.edit', 'procedure.restore', 'knot.manage'];
/** Manages membership, roles and settings. */
const ADMIN: readonly WorkspaceCapability[] = [...EDITOR, 'workspace.members.manage', 'workspace.settings.manage', 'workspace.tools.manage', 'document.purge', 'run.document.remove', 'contact.purge', 'maintenance.purge'];

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

/** Structural views have no tool; Schedule access is decided by its own source kind. */
export function toolForCapability(capability: WorkspaceCapability): WorkspaceTool | null {
  const group = capability.split('.')[0];
  switch (group) {
    case 'procedure': case 'run': case 'knot': return 'PROCEDURES';
    case 'list': return 'LISTS';
    case 'document': return 'DOCUMENTS';
    case 'contact': return 'CONTACTS';
    case 'maintenance': return 'MAINTENANCE';
    default: return null;
  }
}
