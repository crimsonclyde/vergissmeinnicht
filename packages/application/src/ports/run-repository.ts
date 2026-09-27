import type { Actor, ProcedureId, RunDetail, RunId, RunState, RunSummary, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

export type StartRunResult =
  | { readonly status: 'ok'; readonly detail: RunDetail }
  | { readonly status: 'forbidden' | 'procedure_not_found' | 'no_steps' | 'limit_reached' };

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
  /** Newest first, at most `limit` entries. */
  list(workspaceId: WorkspaceId, filter: { readonly state?: RunState | undefined; readonly limit: number }): Promise<RunSummary[]>;
  find(workspaceId: WorkspaceId, runId: RunId): Promise<RunDetail | undefined>;
}
