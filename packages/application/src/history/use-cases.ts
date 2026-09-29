import type { AuditEvent, ProcedureId, RunId, User, WorkspaceId } from '@vergissmeinnicht/domain';
import type { AuditHistory } from '../ports/audit-history.ts';
import type { Page } from '../ports/paging.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { ProcedureNotFoundError } from '../procedures/errors.ts';
import { RunNotFoundError } from '../runs/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface HistoryDeps {
  readonly workspaces: WorkspaceRepository;
  readonly history: AuditHistory;
}

/** Events per page; clients ask for the next page with the returned cursor. */
export const HISTORY_PAGE_SIZE = 500;

/** Who did what and when in a Run. Anyone who may view the Run may read its history. */
export async function getRunHistory(
  deps: HistoryDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId; readonly after?: string | undefined },
): Promise<Page<AuditEvent>> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  const events = await deps.history.forRun(input.workspaceId, input.runId, { limit: HISTORY_PAGE_SIZE, after: input.after });
  if (events === undefined) throw new RunNotFoundError();
  return events;
}

/** Changes to a Procedure definition (created, updated, deleted, restored). */
export async function getProcedureHistory(
  deps: HistoryDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly after?: string | undefined },
): Promise<Page<AuditEvent>> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  // A Procedure id of another Workspace behaves like an unknown id (13.2).
  const events = await deps.history.forProcedure(input.workspaceId, input.procedureId, { limit: HISTORY_PAGE_SIZE, after: input.after });
  if (events === undefined) throw new ProcedureNotFoundError();
  return events;
}
