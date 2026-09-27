import {
  normalizeProcedureContent,
  normalizeProcedureStructure,
  type Procedure,
  type ProcedureId,
  type SectionInput,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { ProcedureDetail, ProcedureRepository, ProcedureWriteResult } from '../ports/procedure-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import {
  InvalidProcedureReferenceError,
  ProcedureConflictError,
  ProcedureLimitReachedError,
  ProcedureNotFoundError,
} from './errors.ts';

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
  /** The complete ordered structure. Omitted items are removed on update. */
  readonly sections: readonly SectionInput[];
}

function normalizeInput(input: ProcedureInput) {
  return { content: normalizeProcedureContent(input), structure: normalizeProcedureStructure(input.sections) };
}

const guard = (capability: WorkspaceCapability): ActorGuard => ({
  actorMay: (role) => roleHasCapability(role, capability),
});

function detailOrThrow(result: ProcedureWriteResult): ProcedureDetail {
  switch (result.status) {
    case 'ok':
      return result.detail;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new ProcedureNotFoundError();
    case 'conflict':
      throw new ProcedureConflictError();
    case 'limit_reached':
      throw new ProcedureLimitReachedError();
    case 'invalid_reference':
      throw new InvalidProcedureReferenceError();
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
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const detail = await deps.procedures.findActive(input.workspaceId, input.procedureId);
  if (detail === undefined) throw new ProcedureNotFoundError();
  return detail;
}

export async function createProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly content: ProcedureInput },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const { content, structure } = normalizeInput(input.content);
  return detailOrThrow(
    await deps.procedures.create(
      { workspaceId: input.workspaceId, content, structure, at: deps.clock.now(), maxActive: MAX_PROCEDURES_PER_WORKSPACE },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}

/**
 * One save of the whole Procedure (content, Sections, Steps), recorded as one audit event.
 * `expectedRevision` is the revision the editor started from; a concurrent save by someone else
 * yields ProcedureConflictError instead of silently overwriting it.
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
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const { content, structure } = normalizeInput(input.content);
  return detailOrThrow(
    await deps.procedures.update(
      {
        workspaceId: input.workspaceId,
        procedureId: input.procedureId,
        expectedRevision: input.expectedRevision,
        content,
        structure,
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
  detailOrThrow(
    await deps.procedures.softDelete(
      { workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now() },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}
