import type { Membership, User, WorkspaceId, WorkspaceTool } from '@vergissmeinnicht/domain';
import type { WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { authorizeWorkspace, type WorkspaceDeps } from '../workspaces/use-cases.ts';

/**
 * The one gate of every route and MCP tool of an optional tool (45.2): the actor is an ACTIVE member,
 * the tool is switched on in this Workspace, and the member's role grants `capability` — checked in
 * that order. A non-member gets WorkspaceNotFoundError, a switched-off tool ToolNotEnabledError (404,
 * admins included; its data stays where it is), a missing capability NotAuthorizedError.
 *
 * `authorizeWorkspace` applies the same check with the tool its capability belongs to; use this helper
 * whenever the tool is not implied by the capability (for example `workspace.view` on the Moon).
 */
export function requireTool(deps: Pick<WorkspaceDeps, 'workspaces'>, actor: User, workspaceId: WorkspaceId, tool: WorkspaceTool, capability: WorkspaceCapability): Promise<Membership> {
  return authorizeWorkspace(deps, actor, workspaceId, capability, tool);
}
