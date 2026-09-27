import type { AuditEvent, ProcedureId, RunId, WorkspaceId } from '@vergissmeinnicht/domain';

/** Read-only access to `audit_events`. There is deliberately no way to change or delete events. */
export interface AuditHistory {
  /** Events of one Run of this Workspace, oldest first; `undefined` if the Run is not in the Workspace. */
  forRun(workspaceId: WorkspaceId, runId: RunId, limit: number): Promise<AuditEvent[] | undefined>;
  /** Events of one Procedure of this Workspace (also after deletion), oldest first. */
  forProcedure(workspaceId: WorkspaceId, procedureId: ProcedureId, limit: number): Promise<AuditEvent[]>;
}
