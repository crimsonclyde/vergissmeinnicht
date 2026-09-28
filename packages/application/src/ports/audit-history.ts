import type { AuditEvent, ProcedureId, RunId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { Page } from './paging.ts';

export interface HistoryPageRequest {
  readonly limit: number;
  /** Id of the last event of the previous page. */
  readonly after?: string | undefined;
}

/**
 * Read-only access to `audit_events`. There is deliberately no way to change or delete events.
 * A cursor that is not an event of the same list throws `InvalidCursorError`.
 */
export interface AuditHistory {
  /** Events of one Run of this Workspace, oldest first; `undefined` if the Run is not in the Workspace. */
  forRun(workspaceId: WorkspaceId, runId: RunId, page: HistoryPageRequest): Promise<Page<AuditEvent> | undefined>;
  /** Events of one Procedure of this Workspace (also after deletion), oldest first. */
  forProcedure(workspaceId: WorkspaceId, procedureId: ProcedureId, page: HistoryPageRequest): Promise<Page<AuditEvent>>;
}
