import type { Actor, StorageUsage, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/**
 * The combined storage of a Workspace (16.4): usage by tool and the limit. Usage is always computed
 * from the rows — in the reading or writing transaction — never kept as a counter that could drift.
 * `pendingSince`: instruction images uploaded since then count even before a Step uses them (14.3).
 */
export interface StorageRepository {
  usage(workspaceId: WorkspaceId, pendingSince: Date): Promise<StorageUsage | undefined>;
  /** Every Workspace with its usage (server admin view), by name. */
  list(pendingSince: Date): Promise<{ readonly workspaceId: WorkspaceId; readonly name: string; readonly usage: StorageUsage }[]>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is still an ACTIVE server admin, sets the
   * ceiling and records WORKSPACE_STORAGE_CEILING_CHANGED in the security log. Deletes nothing.
   */
  setCeiling(input: { readonly workspaceId: WorkspaceId; readonly bytes: number; readonly at: Date }, actor: UserActor): Promise<'ok' | 'forbidden' | 'not_found'>;
  /**
   * In one IMMEDIATE transaction: re-checks the guard, refuses a limit above the ceiling, sets the
   * Workspace's own limit (`null` removes it) and records WORKSPACE_STORAGE_LIMIT_CHANGED in the audit
   * trail. Deletes nothing.
   */
  setLimit(input: { readonly workspaceId: WorkspaceId; readonly bytes: number | null; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<'ok' | 'forbidden' | 'above_ceiling'>;
}
