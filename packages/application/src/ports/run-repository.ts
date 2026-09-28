import type { Page } from './paging.ts';
import type {
  Actor,
  ProcedureId,
  RunDetail,
  RunId,
  RunState,
  RunStep,
  RunStepId,
  RunSummary,
  StepState,
  WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

export type StartRunResult =
  | { readonly status: 'ok'; readonly detail: RunDetail }
  | { readonly status: 'forbidden' | 'procedure_not_found' | 'no_steps' | 'limit_reached' };

export type FinishRunResult =
  | { readonly status: 'ok'; readonly detail: RunDetail }
  | { readonly status: 'forbidden' | 'run_not_found' | 'run_not_active' };

export type StepStateChangeResult =
  | { readonly status: 'ok'; readonly step: RunStep; readonly runRevision: number }
  | { readonly status: 'forbidden' | 'run_not_found' | 'step_not_found' | 'run_not_active' | 'conflict' };

/**
 * Runs are always addressed by Workspace id *and* Run id. The snapshot written by `start` is
 * immutable (enforced by the database); Runs are never deleted.
 */
export interface RunRepository {
  /**
   * In one transaction: re-checks the guard, reads the active Procedure of this Workspace with its
   * current Sections and Steps, copies them into a new ACTIVE Run and records RUN_STARTED.
   */
  start(
    input: { readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date; readonly maxActive: number },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<StartRunResult>;
  /**
   * Newest first, at most `limit` entries, continuing after the Run `before` (the last Run of the
   * previous page; must be a Run of this Workspace matching the filter, else `InvalidCursorError`).
   */
  list(
    workspaceId: WorkspaceId,
    filter: { readonly state?: RunState | undefined; readonly limit: number; readonly before?: string | undefined },
  ): Promise<Page<RunSummary>>;
  find(workspaceId: WorkspaceId, runId: RunId): Promise<RunDetail | undefined>;
  /**
   * In one transaction: re-checks the guard, resolves the Run within the Workspace, requires it to be
   * ACTIVE, calls `validate` with the current Steps (throws if the Run may not end this way, returns
   * the normalized reason), sets the final state with actor, time and reason, bumps the revision and
   * records RUN_COMPLETED / RUN_ABORTED. Afterwards the database refuses any change to the Run.
   */
  finish(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly runId: RunId;
      readonly to: 'COMPLETED' | 'ABORTED';
      readonly at: Date;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
    validate: (steps: readonly RunStep[]) => { readonly reason: string | null },
  ): Promise<FinishRunResult>;
  /**
   * In one transaction: re-checks the guard, resolves the Step within this Run of this Workspace,
   * requires an ACTIVE Run and `expectedState` to be the current state ('conflict' otherwise), calls
   * `validate` with the current Step (which throws for rule violations and returns the normalized
   * reason), writes the new state with actor snapshot and time, bumps the Run revision and records
   * STEP_STATE_CHANGED.
   */
  changeStepState(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly runId: RunId;
      readonly stepId: RunStepId;
      readonly expectedState: StepState;
      readonly to: StepState;
      readonly at: Date;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
    validate: (current: RunStep) => { readonly reason: string | null },
  ): Promise<StepStateChangeResult>;
}
