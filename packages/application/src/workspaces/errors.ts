/**
 * Unknown Workspace, or the caller is not a member: both look the same, so Workspace ids cannot be
 * probed for existence.
 */
export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace not found');
    this.name = 'WorkspaceNotFoundError';
  }
}

/** The target User is not a member of this Workspace. */
export class MemberNotFoundError extends Error {
  constructor() {
    super('Member not found');
    this.name = 'MemberNotFoundError';
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super('The user is already a member of this Workspace');
    this.name = 'AlreadyMemberError';
  }
}

/** The change would leave the Workspace without an ACTIVE member who can manage it. */
export class LastWorkspaceAdminError extends Error {
  constructor() {
    super('A Workspace needs at least one active admin');
    this.name = 'LastWorkspaceAdminError';
  }
}
