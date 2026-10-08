import { DomainValidationError, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import { RECENTLY_COMPLETED_DEFAULT_MS, RECENTLY_COMPLETED_MAX_MS, type TodayFilter, type TodayRepository } from '../ports/today.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
export interface TodayDeps { readonly workspaces: WorkspaceRepository; readonly progress: TodayRepository; readonly clock: Clock }
/**
 * `recentSince`: where the viewer's Recently completed window starts (19.2), from the device's clock —
 * held between now and 8 days back (7 days from local midnight), so a skewed clock never breaks Today;
 * without it the last 3 days.
 */
export async function getTodayProgress(deps: TodayDeps, input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly filter: TodayFilter; readonly recentSince?: Date | undefined }) {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const now = deps.clock.now();
  const asked = input.recentSince?.getTime() ?? now.getTime() - RECENTLY_COMPLETED_DEFAULT_MS;
  if (Number.isNaN(asked)) throw new DomainValidationError('recentSince', 'invalid_instant', 'The window start is not a valid instant');
  const recentSince = new Date(Math.min(now.getTime(), Math.max(now.getTime() - RECENTLY_COMPLETED_MAX_MS, asked)));
  return deps.progress.read({ workspaceId: input.workspaceId, userId: input.actor.id, filter: input.filter, now, recentSince });
}
