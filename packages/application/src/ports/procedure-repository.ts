import type {
  Actor,
  Procedure,
  ProcedureContent,
  ProcedureId,
  ProcedureSection,
  StructureDraft,
  WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

/** A Procedure with its ordered Sections and Steps. */
export interface ProcedureDetail {
  readonly procedure: Procedure;
  readonly sections: readonly ProcedureSection[];
}

/** How a new Procedure came to be; recorded in its PROCEDURE_CREATED audit event. */
export type ProcedureOrigin =
  | { readonly kind: 'created' }
  | { readonly kind: 'imported' }
  | { readonly kind: 'duplicated'; readonly sourceProcedureId: ProcedureId };

export type ProcedureWriteResult =
  | { readonly status: 'ok'; readonly detail: ProcedureDetail }
  | { readonly status: 'forbidden' | 'not_found' | 'conflict' | 'limit_reached' | 'invalid_reference' };

/**
 * Every lookup and write is scoped by Workspace id *and* Procedure id, so a Procedure id from another
 * Workspace behaves like an unknown id. Soft-deleted Procedures are invisible to these methods.
 * Every mutation re-checks the guard and writes one audit event in the same transaction.
 *
 * Structure drafts may name existing Section/Step ids; they must belong to the Procedure being
 * written (otherwise 'invalid_reference', nothing written). New items get server-generated ids.
 */
export interface ProcedureRepository {
  /** Not deleted, ordered by title. */
  listActive(workspaceId: WorkspaceId): Promise<Procedure[]>;
  findActive(workspaceId: WorkspaceId, procedureId: ProcedureId): Promise<ProcedureDetail | undefined>;
  create(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly content: ProcedureContent;
      readonly structure: StructureDraft;
      readonly origin: ProcedureOrigin;
      readonly at: Date;
      readonly maxActive: number;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
  /** Replaces content and structure as one save. 'conflict' when `expectedRevision` is not current. */
  update(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly procedureId: ProcedureId;
      readonly expectedRevision: number;
      readonly content: ProcedureContent;
      readonly structure: StructureDraft;
      readonly at: Date;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
  /** Sets deletion metadata; the rows and anything referencing them stay intact. */
  softDelete(
    input: { readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
}
