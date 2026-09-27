import type { ProcedureId, RunDetail, RunId, RunState, RunSummary, User, WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { RunRepository } from '../ports/run-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ProcedureHasNoStepsError, RunLimitReachedError, RunNotFoundError } from './errors.ts';

export interface RunDeps {
  readonly workspaces: WorkspaceRepository;
  readonly runs: RunRepository;
  readonly clock: Clock;
}

/** Resource bound: ACTIVE Runs per Workspace. Finished Runs are history and not limited. */
export const MAX_ACTIVE_RUNS_PER_WORKSPACE = 500;
/** Page size of the Run list. */
export const RUN_LIST_LIMIT = 200;

/**
 * Starts a Run from the Procedure's current definition. Multiple active Runs of the same Procedure
 * are allowed. The snapshot is taken inside the write transaction, so a concurrent edit is either
 * fully before or fully after it.
 */
export async function startRun(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<RunDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.start');
  const result = await deps.runs.start(
    { workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now(), maxActive: MAX_ACTIVE_RUNS_PER_WORKSPACE },
    userActor(input.actor),
    { actorMay: (role) => roleHasCapability(role, 'run.start') },
  );
  switch (result.status) {
    case 'ok':
      return result.detail;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'procedure_not_found':
      throw new ProcedureNotFoundError();
    case 'no_steps':
      throw new ProcedureHasNoStepsError();
    case 'limit_reached':
      throw new RunLimitReachedError();
  }
}

export async function listRuns(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly state?: RunState | undefined },
): Promise<RunSummary[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  return deps.runs.list(input.workspaceId, { state: input.state, limit: RUN_LIST_LIMIT });
}

export async function getRun(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId },
): Promise<RunDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  const detail = await deps.runs.find(input.workspaceId, input.runId);
  if (detail === undefined) throw new RunNotFoundError();
  return detail;
}
