import { DomainValidationError } from './errors.ts';
import type { WorkspaceRole } from './states.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4, type UserId } from './user.ts';

/**
 * The primary collaboration and security boundary. Procedures and Runs belong to exactly one
 * Workspace; access is granted only through a Membership.
 */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Maps one User to one Workspace with exactly one role. */
export interface Membership {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: WorkspaceRole;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Opaque identifiers are not authorization: a well-formed id still needs a Membership check. */
export function parseWorkspaceId(value: string): WorkspaceId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('workspaceId', 'invalid_workspace_id', 'Workspace id must be a lower-case UUIDv4');
  }
  return value as WorkspaceId;
}

export const MAX_WORKSPACE_NAME_LENGTH = 80;

export function normalizeWorkspaceName(input: string): string {
  return normalizeSingleLineName(input, {
    field: 'name',
    codePrefix: 'workspace_name',
    label: 'Workspace name',
    maxLength: MAX_WORKSPACE_NAME_LENGTH,
  });
}
