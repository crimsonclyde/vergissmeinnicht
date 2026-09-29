import type { ProcedureId, RunId, UserId, WorkspaceId } from '@vergissmeinnicht/domain';

/** How a Procedure is being used, for compact cards (13.10, 13.16). */
export interface ProcedureActivity {
  readonly lastCompletedAt: Date | null;
  /** Active executions, oldest first (several are allowed). */
  readonly active: readonly { readonly runId: RunId; readonly startedBy: string; readonly startedAt: Date }[];
}

/**
 * Personal and derived views of Procedures (13.12, 13.13): pins belong to one person and are not
 * Workspace history (never audited); Recent is derived from Runs the person started — opening a
 * Procedure does not count.
 */
export interface ProcedureActivityRepository {
  /** False if the Procedure is not a non-deleted Procedure of this Workspace. */
  pin(input: { readonly userId: UserId; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date }): Promise<boolean>;
  /** False if the Procedure is not a non-deleted Procedure of this Workspace. */
  unpin(userId: UserId, workspaceId: WorkspaceId, procedureId: ProcedureId): Promise<boolean>;
  /** The person's pinned Procedures of this Workspace, in pinning order. */
  pinnedIds(userId: UserId, workspaceId: WorkspaceId): Promise<ProcedureId[]>;
  /** Non-deleted Procedures of this Workspace the person started most recently, newest first. */
  recentIds(userId: UserId, workspaceId: WorkspaceId, limit: number): Promise<ProcedureId[]>;
  /** Activity of every Procedure of the Workspace that has any. */
  activity(workspaceId: WorkspaceId): Promise<ReadonlyMap<ProcedureId, ProcedureActivity>>;
}
