import type { Actor, Knot, KnotId, KnotTarget, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

export type CreateKnotResult =
  | { readonly status: 'ok'; readonly knot: Knot }
  | { readonly status: 'forbidden' | 'target_not_found' | 'limit_reached' };

export type RevokeKnotResult = 'ok' | 'forbidden' | 'knot_not_found' | 'already_revoked';

/** A Knot with what the management list shows about its target. */
export interface KnotListEntry {
  readonly knot: Knot;
  readonly targetTitle: string;
  /** False when the target Procedure was deleted (the Knot then resolves to nothing). */
  readonly targetAvailable: boolean;
}

/**
 * Knots are addressed by Workspace id + Knot id for management, and by token hash only for
 * resolution. Only the hash of a token ever reaches storage.
 */
export interface KnotRepository {
  /**
   * In one transaction: re-checks the guard, requires the target to exist in this Workspace (a
   * non-deleted Procedure or any Run), enforces `maxActive` unrevoked, unexpired Knots, stores the
   * Knot and records KNOT_CREATED.
   */
  create(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly target: KnotTarget;
      readonly label: string;
      readonly tokenHash: string;
      readonly at: Date;
      readonly expiresAt: Date | null;
      readonly maxActive: number;
    },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<CreateKnotResult>;
  /** Newest first, at most `limit` entries, including expired and revoked Knots. */
  list(workspaceId: WorkspaceId, limit: number): Promise<KnotListEntry[]>;
  /** In one transaction: re-checks the guard, sets the revocation once and records KNOT_REVOKED. */
  revoke(
    input: { readonly workspaceId: WorkspaceId; readonly knotId: KnotId; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<RevokeKnotResult>;
  findByTokenHash(tokenHash: string): Promise<Knot | undefined>;
  /** Whether the target can still be opened: the Run exists, or the Procedure exists and is not deleted. */
  targetAvailable(knot: Knot): Promise<boolean>;
}
