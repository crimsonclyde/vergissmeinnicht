import type { WorkspaceRole, WorkspaceTool } from '@vergissmeinnicht/domain';

/**
 * Re-evaluated inside a mutating transaction, so a concurrent demotion, removal or disabling of
 * the actor cannot slip between the use-case's authorization check and the write. The repository
 * refuses when the actor is no longer an ACTIVE member or `actorMay` rejects their current role.
 */
export interface ActorGuard {
  readonly tool?: WorkspaceTool;
  readonly actorMay: (actorRole: WorkspaceRole) => boolean;
}
