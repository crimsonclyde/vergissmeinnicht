import {
  normalizeProcedureContent,
  type Procedure,
  type ProcedureId,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { ProcedureRepository, ProcedureWriteResult } from '../ports/procedure-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ProcedureConflictError, ProcedureLimitReachedError, ProcedureNotFoundError } from './errors.ts';

export interface ProcedureDeps {
  readonly workspaces: WorkspaceRepository;
  readonly procedures: ProcedureRepository;
  readonly clock: Clock;
}

/** Resource bound per Workspace (docu/security.md §5: sensible limits). */
export const MAX_PROCEDURES_PER_WORKSPACE = 1000;

export interface ProcedureInput {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: readonly string[];
}

const guard = (capability: WorkspaceCapability): ActorGuard => ({
  actorMay: (role) => roleHasCapability(role, capability),
});

function procedureOrThrow(result: ProcedureWriteResult): Procedure {
  switch (result.status) {
    case 'ok':
      return result.procedure;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ProcedureNotFoundError();
    case 'conflict':
      throw new ProcedureConflictError();
    case 'limit_reached':
      throw new ProcedureLimitReachedError();
  }
}

/** All non-deleted Procedures of the Workspace (Workspace-wide visibility, Step 3.3). */
export async function listProcedures(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId },
): Promise<Procedure[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.procedures.listActive(input.workspaceId);
}

export async function getProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<Procedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const procedure = await deps.procedures.findActive(input.workspaceId, input.procedureId);
  if (procedure === undefined) throw new ProcedureNotFoundError();
  return procedure;
}

export async function createProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly content: ProcedureInput },
): Promise<Procedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const content = normalizeProcedureContent(input.content);
  return procedureOrThrow(
    await deps.procedures.create(
      { workspaceId: input.workspaceId, content, at: deps.clock.now(), maxActive: MAX_PROCEDURES_PER_WORKSPACE },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}

/**
 * Replaces the editable content. `expectedRevision` is the revision the editor started from;
 * a concurrent edit by someone else yields ProcedureConflictError instead of silently overwriting it.
 */
export async function updateProcedure(
  deps: ProcedureDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly procedureId: ProcedureId;
    readonly expectedRevision: number;
    readonly content: ProcedureInput;
  },
): Promise<Procedure> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const content = normalizeProcedureContent(input.content);
  return procedureOrThrow(
    await deps.procedures.update(
      {
        workspaceId: input.workspaceId,
        procedureId: input.procedureId,
        expectedRevision: input.expectedRevision,
        content,
        at: deps.clock.now(),
      },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}

/** Soft delete: the definition is hidden, never destroyed; historical Runs are unaffected. */
export async function deleteProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  procedureOrThrow(
    await deps.procedures.softDelete(
      { workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now() },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}
