import type { Actor, User, WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from './invitations/errors.ts';
import type { ActorGuard } from './ports/actor-guard.ts';
import type { Clock } from './ports/clock.ts';
import type { WorkspaceRepository } from './ports/workspace-repository.ts';
import { userActor } from './user-actor.ts';
import { authorizeWorkspace } from './workspaces/use-cases.ts';

/** A Workspace admin turned AI assistants off for this Workspace (45.11): no MCP connection may reach it. */
export class AiAssistantsBlockedError extends Error {
  constructor() {
    super('AI assistants are switched off in this Workspace');
    this.name = 'AiAssistantsBlockedError';
  }
}

export interface AiAssistantsRepository {
  /** Whether AI assistants may reach the Workspace (true for an unknown id: membership decides elsewhere). */
  allowed(workspaceId: WorkspaceId): Promise<boolean>;
  set(input: { readonly workspaceId: WorkspaceId; readonly allowed: boolean; readonly at: Date }, actor: Actor & { readonly kind: 'user' }, guard: ActorGuard): Promise<'ok' | 'forbidden'>;
}

export interface AiAssistantsDeps {
  readonly workspaces: WorkspaceRepository;
  readonly aiAssistants: AiAssistantsRepository;
  readonly clock: Clock;
}

/** Every member may know whether AI assistants are allowed (it explains why a connection skips the Workspace). */
export async function aiAssistantsAllowed(deps: AiAssistantsDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId }): Promise<boolean> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  return deps.aiAssistants.allowed(input.workspaceId);
}

/**
 * A Workspace admin (`workspace.settings.manage`) allows or blocks AI assistants for every member
 * (45.11). Blocking takes effect on the next MCP call: existing connections stay, but skip this
 * Workspace. Audited; re-checked inside the write.
 */
export async function setAiAssistants(deps: AiAssistantsDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly allowed: boolean }): Promise<boolean> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.settings.manage');
  const result = await deps.aiAssistants.set({ workspaceId: input.workspaceId, allowed: input.allowed, at: deps.clock.now() }, userActor(input.actor), {
    actorMay: (role) => roleHasCapability(role, 'workspace.settings.manage'),
  });
  if (result === 'forbidden') throw new NotAuthorizedError();
  return deps.aiAssistants.allowed(input.workspaceId);
}
