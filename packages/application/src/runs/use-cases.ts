import {
  validateStepTransition,
  type ProcedureId,
  type RunDetail,
  type RunId,
  type RunState,
  type RunStep,
  type RunStepId,
  type RunSummary,
  type StepState,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { RunRepository } from '../ports/run-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import {
  ProcedureHasNoStepsError,
  RunLimitReachedError,
  RunNotActiveError,
  RunNotFoundError,
  RunStepNotFoundError,
  StepStateConflictError,
} from './errors.ts';

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

/**
 * Changes one Step's execution state (resolve as DONE / SKIPPED / NOT_APPLICABLE, or undo to
 * PENDING). Any member with `run.execute` may work on any active Run of the Workspace.
 * `expectedState` is the state the caller saw; if someone else changed the Step in between, the
 * call fails with StepStateConflictError instead of overwriting their change. Transition and reason
 * rules are checked against the Step's snapshotted policies inside the write transaction.
 */
export async function changeStepState(
  deps: RunDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly runId: RunId;
    readonly stepId: RunStepId;
    readonly expectedState: StepState;
    readonly to: StepState;
    readonly reason?: string | undefined;
  },
): Promise<{ step: RunStep; runRevision: number }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.execute');
  const result = await deps.runs.changeStepState(
    {
      workspaceId: input.workspaceId,
      runId: input.runId,
      stepId: input.stepId,
      expectedState: input.expectedState,
      to: input.to,
      at: deps.clock.now(),
    },
    userActor(input.actor),
    { actorMay: (role) => roleHasCapability(role, 'run.execute') },
    (current) => validateStepTransition(current, input.to, input.reason),
  );
  switch (result.status) {
    case 'ok':
      return { step: result.step, runRevision: result.runRevision };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'run_not_found':
      throw new RunNotFoundError();
    case 'step_not_found':
      throw new RunStepNotFoundError();
    case 'run_not_active':
      throw new RunNotActiveError();
    case 'conflict':
      throw new StepStateConflictError();
  }
}
