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

/** A soft-deleted Procedure as shown in the restore view. */
export interface DeletedProcedure {
  readonly procedure: Procedure;
  readonly deletedAt: Date;
  readonly deletedBy: { readonly userId: string; readonly displayName: string };
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
  /** Soft-deleted Procedures of the Workspace, most recently deleted first. */
  listDeleted(workspaceId: WorkspaceId): Promise<DeletedProcedure[]>;
  /** One soft-deleted Procedure of this Workspace with its Sections and Steps; undefined if not deleted or elsewhere. */
  findDeleted(workspaceId: WorkspaceId, procedureId: ProcedureId): Promise<ProcedureDetail | undefined>;
  /**
   * Clears the deletion metadata of a soft-deleted Procedure of this Workspace (with its Sections and
   * Steps) and bumps the revision. 'not_found' if it is not deleted or belongs elsewhere;
   * 'limit_reached' if the Workspace is at its active-Procedure limit.
   */
  restore(
    input: { readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date; readonly maxActive: number },
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
