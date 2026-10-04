import type { ActorGuard } from '@vergissmeinnicht/application';
import type { Actor, WorkspaceId } from '@vergissmeinnicht/domain';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './connection.ts';
import { memberships, users, workspaceTools } from './schema.ts';

export type Transaction = Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0];
export type UserActor = Actor & { readonly kind: 'user' };

// IMMEDIATE takes the write lock before the first read: guard checks and the write are serialized
// against concurrent membership changes (also from other processes).
export const IMMEDIATE = { behavior: 'immediate' } as const;

/** Inside a write transaction: the actor must still be an ACTIVE member whose current role passes the guard. */
export function actorAllowed(tx: Transaction, workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard): boolean {
  const row = tx
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, actor.userId), eq(users.status, 'ACTIVE')))
    .get();
  return row !== undefined && guard.actorMay(row.role) && (guard.tool === undefined || tx.select({ enabled: workspaceTools.enabled }).from(workspaceTools).where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, guard.tool))).get()?.enabled === true);
}
