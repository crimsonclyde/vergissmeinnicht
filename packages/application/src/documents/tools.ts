import { parseWorkspaceTool, type User, type WorkspaceId, type WorkspaceTool } from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ToolNotEnabledError } from './errors.ts';

export interface ToolDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly clock: Clock;
}

export class ToolSettingsConflictError extends Error {
  constructor() {
    super('Workspace tools were changed meanwhile');
    this.name = 'ToolSettingsConflictError';
  }
}

/**
 * The gate of every route of an optional tool: the actor is a member with the capability **and** the
 * tool is switched on in this Workspace. A disabled tool looks like an unknown resource (404) — to
 * everyone, admins included; its data stays where it is.
 */
export async function authorizeTool(deps: Pick<ToolDeps, 'workspaces' | 'tools'>, actor: User, workspaceId: WorkspaceId, tool: WorkspaceTool, capability: WorkspaceCapability): Promise<void> {
  // Membership first (a non-member learns nothing), then the switch (a disabled tool is 404 whatever the
  // member's role), then the capability.
  const membership = await authorizeWorkspace(deps, actor, workspaceId, 'workspace.view');
  if (!(await deps.tools.enabled(workspaceId)).includes(tool)) throw new ToolNotEnabledError();
  if (!roleHasCapability(membership.role, capability)) throw new NotAuthorizedError();
}

/** The optional tools switched on in the Workspace: every member may know (it decides what the navigation shows). */
export async function enabledTools(deps: Pick<ToolDeps, 'workspaces' | 'tools'>, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<WorkspaceTool[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  return deps.tools.enabled(input.workspaceId);
}

/**
 * A Workspace admin switches an optional tool on or off (`workspace.tools.manage`). Switching off hides
 * the tool from everyone and deletes nothing; switching on again shows the same data. Audited.
 */
export async function setWorkspaceTool(deps: ToolDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly tool: string; readonly enabled: boolean; readonly expectedRevision?: number }): Promise<WorkspaceTool[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.tools.manage');
  const tool = parseWorkspaceTool(input.tool);
  const expectedRevision = input.expectedRevision ?? await deps.tools.revision(input.workspaceId);
  const result = await deps.tools.set({ workspaceId: input.workspaceId, tool, enabled: input.enabled, expectedRevision, at: deps.clock.now() }, userActor(input.actor), {
    actorMay: (role) => roleHasCapability(role, 'workspace.tools.manage'),
  });
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'conflict') throw new ToolSettingsConflictError();
  return deps.tools.enabled(input.workspaceId);
}
