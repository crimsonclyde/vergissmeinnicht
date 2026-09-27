import type { AuditEvent, ProcedureId, RunId, User, WorkspaceId } from '@vergissmeinnicht/domain';
import type { AuditHistory } from '../ports/audit-history.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { RunNotFoundError } from '../runs/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface HistoryDeps {
  readonly workspaces: WorkspaceRepository;
  readonly history: AuditHistory;
}

/** Upper bound of events returned per request (a Run has at most 200 Steps). */
export const HISTORY_LIMIT = 1000;

/** Who did what and when in a Run. Anyone who may view the Run may read its history. */
export async function getRunHistory(
  deps: HistoryDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly runId: RunId },
): Promise<AuditEvent[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  const events = await deps.history.forRun(input.workspaceId, input.runId, HISTORY_LIMIT);
  if (events === undefined) throw new RunNotFoundError();
  return events;
}

/** Changes to a Procedure definition (created, updated, deleted, restored). */
export async function getProcedureHistory(
  deps: HistoryDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<AuditEvent[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.history.forProcedure(input.workspaceId, input.procedureId, HISTORY_LIMIT);
}
