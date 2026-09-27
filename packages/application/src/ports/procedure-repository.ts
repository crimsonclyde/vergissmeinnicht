import type { Actor, Procedure, ProcedureContent, ProcedureId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

export type ProcedureWriteResult =
  | { readonly status: 'ok'; readonly procedure: Procedure }
  | { readonly status: 'forbidden' | 'not_found' | 'conflict' | 'limit_reached' };

/**
 * Every lookup and write is scoped by Workspace id *and* Procedure id, so a Procedure id from another
 * Workspace behaves like an unknown id. Soft-deleted Procedures are invisible to these methods.
 * Every mutation re-checks the guard and writes its audit event in the same transaction.
 */
export interface ProcedureRepository {
  /** Not deleted, ordered by title. */
  listActive(workspaceId: WorkspaceId): Promise<Procedure[]>;
  findActive(workspaceId: WorkspaceId, procedureId: ProcedureId): Promise<Procedure | undefined>;
  create(
    input: { readonly workspaceId: WorkspaceId; readonly content: ProcedureContent; readonly at: Date; readonly maxActive: number },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
  /** 'conflict' when `expectedRevision` is not the current revision. */
  update(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly procedureId: ProcedureId;
      readonly expectedRevision: number;
      readonly content: ProcedureContent;
      readonly at: Date;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
  /** Sets deletion metadata; the row and anything referencing it stay intact. */
  softDelete(
    input: { readonly workspaceId: WorkspaceId; readonly procedureId: ProcedureId; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<ProcedureWriteResult>;
}
