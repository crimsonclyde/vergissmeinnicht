import type { User, WorkspaceId } from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { TodayFilter, TodayRepository } from '../ports/today.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
export interface TodayDeps { readonly workspaces: WorkspaceRepository; readonly progress: TodayRepository; readonly clock: Clock }
export async function getTodayProgress(deps: TodayDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly filter: TodayFilter }) {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  return deps.progress.read({ workspaceId: input.workspaceId, userId: input.actor.id, filter: input.filter, now: deps.clock.now() });
}
