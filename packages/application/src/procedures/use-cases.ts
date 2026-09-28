import {
  copyTitle,
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
import type {
  DeletedProcedure,
  ProcedureDetail,
  ProcedureOrigin,
  ProcedureRepository,
  ProcedureWriteResult,
} from '../ports/procedure-repository.ts';
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

async function create(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly content: ProcedureInput },
  origin: ProcedureOrigin,
): Promise<ProcedureDetail> {
  const { content, structure } = normalizeInput(input.content);
  return detailOrThrow(
    await deps.procedures.create(
      {
        workspaceId: input.workspaceId,
        content,
        structure,
        origin,
        at: deps.clock.now(),
        maxActive: MAX_PROCEDURES_PER_WORKSPACE,
      },
      userActor(input.actor),
      guard('procedure.edit'),
    ),
  );
}

export async function createProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly content: ProcedureInput },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  return create(deps, input, { kind: 'created' });
}

/**
 * Creates a Procedure from an already parsed import document. The content passes exactly the same
 * domain rules, limits and authorization as a Procedure created by hand; ids are always new.
 */
export async function importProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly content: ProcedureInput },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  return create(deps, input, { kind: 'imported' });
}

/**
 * Copies a Procedure within its Workspace (new ids everywhere). Copying into another Workspace is
 * export + import, which checks the permissions of both Workspaces separately.
 */
export async function duplicateProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const source = await deps.procedures.findActive(input.workspaceId, input.procedureId);
  if (source === undefined) throw new ProcedureNotFoundError();
  const content: ProcedureInput = {
    title: copyTitle(source.procedure.title),
    description: source.procedure.description,
    icon: source.procedure.icon,
    tags: source.procedure.tags,
    sections: source.sections.map((section) => ({
      title: section.title,
      description: section.description,
      steps: section.steps.map((step) => ({
        title: step.title,
        description: step.description,
        icon: step.icon,
        required: step.required,
        critical: step.critical,
        skipReasonPolicy: step.skipReasonPolicy,
        notApplicableReasonPolicy: step.notApplicableReasonPolicy,
      })),
    })),
  };
  return create(deps, { ...input, content }, { kind: 'duplicated', sourceProcedureId: input.procedureId });
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

/** The restore view: soft-deleted Procedures of the Workspace. */
export async function listDeletedProcedures(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId },
): Promise<DeletedProcedure[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.restore');
  return deps.procedures.listDeleted(input.workspaceId);
}

/** A soft-deleted Procedure in full, so it can be checked before restoring. Same capability as restoring. */
export async function getDeletedProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.restore');
  const detail = await deps.procedures.findDeleted(input.workspaceId, input.procedureId);
  if (detail === undefined) throw new ProcedureNotFoundError();
  return detail;
}

/** Brings a soft-deleted Procedure back, unchanged except for a new revision. Audited. */
export async function restoreProcedure(
  deps: ProcedureDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.restore');
  return detailOrThrow(
    await deps.procedures.restore(
      { workspaceId: input.workspaceId, procedureId: input.procedureId, at: deps.clock.now(), maxActive: MAX_PROCEDURES_PER_WORKSPACE },
      userActor(input.actor),
      guard('procedure.restore'),
    ),
  );
}
