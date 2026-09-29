import {
  DomainValidationError,
  UUID_V4,
  completionBlockers,
  normalizeOptionalReason,
  validateStepTransition,
  type ProcedureId,
  type ScheduledProcedureId,
  type Run,
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
import type { Page } from '../ports/paging.ts';
import type { RunChangeNotifier } from '../ports/run-changes.ts';
import type { FinishRunResult, RunRepository } from '../ports/run-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { ScheduleClosedError } from '../schedules/errors.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import {
  OfflineAccountMismatchError,
  ProcedureHasNoStepsError,
  RunIncompleteError,
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
  /** Realtime fan-out of committed changes; without it nothing is pushed (CLI, most tests). */
  readonly changes?: RunChangeNotifier | undefined;
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
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly procedureId: ProcedureId;
    /** Started from this scheduled item (13.4): it is closed as STARTED in the same transaction. */
    readonly fromSchedule?: ScheduledProcedureId | undefined;
  },
): Promise<RunDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.start');
  const result = await deps.runs.start(
    {
      workspaceId: input.workspaceId,
      procedureId: input.procedureId,
      at: deps.clock.now(),
      maxActive: MAX_ACTIVE_RUNS_PER_WORKSPACE,
      fromSchedule: input.fromSchedule,
    },
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
    case 'schedule_not_open':
      throw new ScheduleClosedError();
  }
}

export async function listRuns(
  deps: RunDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly state?: RunState | undefined;
    /** Only Runs of this Procedure (e.g. its active executions, 13.18). */
    readonly procedureId?: ProcedureId | undefined;
    readonly before?: string | undefined;
  },
): Promise<Page<RunSummary>> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  return deps.runs.list(input.workspaceId, { state: input.state, procedureId: input.procedureId, limit: RUN_LIST_LIMIT, before: input.before });
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
 * Authorizes (and re-authorizes) a realtime subscription to one Run: the actor needs `run.view`
 * in the Workspace and the Run must belong to it. Returns the Run's current state and revision.
 * The realtime layer calls this again before delivering each change and periodically, so removed
 * members, demotions below GUEST and disabled accounts lose the subscription.
 */
export async function authorizeRunSubscription(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId },
): Promise<Run> {
  return (await getRun(deps, input)).run;
}

/**
 * Changes one Step's execution state (resolve as DONE / SKIPPED / NOT_APPLICABLE, or undo to
 * PENDING). Any member with `run.execute` may work on any active Run of the Workspace.
 * `expectedState` is the state the caller saw; if someone else changed the Step in between, the
 * call fails with StepStateConflictError instead of overwriting their change. Transition and reason
 * rules are checked against the Step's snapshotted policies inside the write transaction.
 */
/** Client change ids are random UUIDv4s chosen by the device. */
function parseClientChangeId(value: string): string {
  if (!UUID_V4.test(value)) throw new DomainValidationError('clientChangeId', 'invalid_client_change_id', 'Client change id must be a UUIDv4');
  return value;
}

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
    /**
     * A change made offline and sent later (8.5): a client-chosen UUID (same change sent twice is
     * applied once), the id of the account that made it on the device (must be the caller) and the
     * device time it was made at (stored only if plausible, never authoritative).
     */
    readonly offline?: { readonly clientChangeId: string; readonly madeBy: string; readonly deviceAt?: Date | undefined } | undefined;
  },
): Promise<{ step: RunStep; runRevision: number; duplicate: boolean }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.execute');
  if (input.offline !== undefined && input.offline.madeBy !== input.actor.id) throw new OfflineAccountMismatchError();
  const offline =
    input.offline === undefined
      ? undefined
      : { clientChangeId: parseClientChangeId(input.offline.clientChangeId), deviceAt: input.offline.deviceAt };
  const result = await deps.runs.changeStepState(
    {
      workspaceId: input.workspaceId,
      runId: input.runId,
      stepId: input.stepId,
      expectedState: input.expectedState,
      to: input.to,
      at: deps.clock.now(),
      offline,
    },
    userActor(input.actor),
    { actorMay: (role) => roleHasCapability(role, 'run.execute') },
    (current) => validateStepTransition(current, input.to, input.reason),
  );
  switch (result.status) {
    case 'ok':
      if (result.duplicate === true) return { step: result.step, runRevision: result.runRevision, duplicate: true };
      deps.changes?.runChanged({
        workspaceId: input.workspaceId,
        runId: input.runId,
        revision: result.runRevision,
        kind: 'STEP_STATE_CHANGED',
        stepId: result.step.id,
        by: input.actor.displayName,
        at: result.step.stateChange?.at ?? deps.clock.now(),
      });
      return { step: result.step, runRevision: result.runRevision, duplicate: false };
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

function finishedOrThrow(deps: RunDeps, result: FinishRunResult): RunDetail {
  switch (result.status) {
    case 'ok': {
      const { run } = result.detail;
      if (run.ended !== null) {
        deps.changes?.runChanged({
          workspaceId: run.workspaceId,
          runId: run.id,
          revision: run.revision,
          kind: run.state === 'COMPLETED' ? 'RUN_COMPLETED' : 'RUN_ABORTED',
          stepId: null,
          by: run.ended.by.displayName,
          at: run.ended.at,
        });
      }
      return result.detail;
    }
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'run_not_found':
      throw new RunNotFoundError();
    case 'run_not_active':
      throw new RunNotActiveError();
  }
}

/**
 * Completes an ACTIVE Run. Every required Step must be DONE or NOT_APPLICABLE (SKIPPED does not
 * count); optional Steps may be in any state. Checked on the current Steps inside the transaction.
 */
export async function completeRun(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId },
): Promise<RunDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.execute');
  return finishedOrThrow(
    deps,
    await deps.runs.finish(
      { workspaceId: input.workspaceId, runId: input.runId, to: 'COMPLETED', at: deps.clock.now() },
      userActor(input.actor),
      { actorMay: (role) => roleHasCapability(role, 'run.execute') },
      (steps) => {
        const blockers = completionBlockers(steps);
        if (blockers.length > 0) throw new RunIncompleteError(blockers.length);
        return { reason: null };
      },
    ),
  );
}

/** Ends an ACTIVE Run without completing it, with an optional reason. Allowed regardless of Step states. */
export async function abortRun(
  deps: RunDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId; readonly reason?: string | undefined },
): Promise<RunDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.abort');
  const reason = normalizeOptionalReason(input.reason);
  return finishedOrThrow(
    deps,
    await deps.runs.finish(
      { workspaceId: input.workspaceId, runId: input.runId, to: 'ABORTED', at: deps.clock.now() },
      userActor(input.actor),
      { actorMay: (role) => roleHasCapability(role, 'run.abort') },
      () => ({ reason }),
    ),
  );
}
