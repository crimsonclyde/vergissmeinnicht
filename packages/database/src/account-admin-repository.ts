import { and, asc, count, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { AccountAdminRepository, AccountStatusChangeResult } from '@vergissmeinnicht/application';
import type { NormalizedEmail, UserId, WorkspaceId, WorkspaceRole } from '@vergissmeinnicht/domain';
import { revokeAllAccess } from './access-revocation.ts';
import { IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { accountRecoveries, historicalIdentityOrigins, invitations, memberships, totpCredentials, users, workspaces } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

/** Thrown inside the transaction so better-sqlite3 rolls it back; carries the result to report. */
class Abort extends Error {
  readonly result: AccountStatusChangeResult;

  constructor(result: AccountStatusChangeResult) {
    super(result.outcome);
    this.result = result;
  }
}

/** Workspaces in which `userId` is the only ACTIVE member holding one of `managingRoles`. */
function soleManagedWorkspaces(tx: Transaction, userId: string, managingRoles: readonly WorkspaceRole[]) {
  if (managingRoles.length === 0) return [];
  const managed = tx
    .select({ id: workspaces.id, name: workspaces.name })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), inArray(memberships.role, [...managingRoles])))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .all();
  return managed.filter((workspace) => {
    const others =
      tx
        .select({ n: count() })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.workspaceId, workspace.id),
            ne(memberships.userId, userId),
            inArray(memberships.role, [...managingRoles]),
            eq(users.status, 'ACTIVE'),
          ),
        )
        .get()?.n ?? 0;
    return others === 0;
  });
}

export function createAccountAdminRepository({ db }: Pick<AppDatabase, 'db'>): AccountAdminRepository {
  return {
    async list() {
      return db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.name,
          status: users.status,
          serverAdmin: users.serverAdmin,
          createdAt: users.createdAt,
          totpEnabledAt: totpCredentials.enabledAt,
        })
        .from(users)
        .leftJoin(totpCredentials, eq(totpCredentials.userId, users.id))
        // Historical identities (section 18) are names in restored history, not accounts to manage.
        .where(ne(users.status, 'IMPORTED'))
        .orderBy(asc(users.name), asc(users.id))
        .all()
        .map(({ totpEnabledAt, ...row }) => ({
          ...row,
          id: row.id as UserId,
          email: row.email as NormalizedEmail,
          totpEnabled: totpEnabledAt !== null,
        }));
    },

    async historicalIdentities(limit) {
      const total = db.select({ n: count() }).from(users).where(eq(users.status, 'IMPORTED')).get()?.n ?? 0;
      // No email (a reserved placeholder), no credentials — there are none: name and origin only.
      const rows = db
        .select({ id: users.id, displayName: users.name, workspaceId: historicalIdentityOrigins.workspaceId, workspaceName: workspaces.name, restoredAt: historicalIdentityOrigins.restoredAt })
        .from(users)
        .leftJoin(historicalIdentityOrigins, eq(historicalIdentityOrigins.userId, users.id))
        .leftJoin(workspaces, eq(workspaces.id, historicalIdentityOrigins.workspaceId))
        .where(eq(users.status, 'IMPORTED'))
        .orderBy(desc(historicalIdentityOrigins.restoredAt), asc(users.name), asc(users.id))
        .limit(limit)
        .all();
      return {
        total,
        items: rows.map((row) => ({
          id: row.id as UserId,
          displayName: row.displayName,
          origin: row.workspaceId === null || row.workspaceName === null || row.restoredAt === null ? null : { workspaceId: row.workspaceId as WorkspaceId, workspaceName: row.workspaceName, restoredAt: row.restoredAt },
        })),
      };
    },

    async setStatus(input, actor) {
      try {
        return db.transaction((tx): AccountStatusChangeResult => {
          const actorRow = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
          if (actorRow?.status !== 'ACTIVE' || !actorRow.serverAdmin || actor.userId === input.userId) {
            return { outcome: 'forbidden' };
          }
          const target = tx.select({ status: users.status }).from(users).where(eq(users.id, input.userId)).get();
          // A historical identity is never enabled or disabled: it is no account (answered like an unknown one).
          if (target === undefined || target.status === 'IMPORTED') return { outcome: 'not_found' };
          if (target.status === input.status) return { outcome: 'unchanged' };

          const event = { actor, subjectType: 'user' as const, subjectId: input.userId, occurredAt: input.at };
          tx.update(users).set({ status: input.status, updatedAt: input.at }).where(eq(users.id, input.userId)).run();

          if (input.status === 'ACTIVE') {
            recordSecurityEvent(tx, { ...event, type: 'ACCOUNT_ENABLED' });
            return { outcome: 'ok', sessionsRevoked: 0 };
          }

          // Checked after the update, inside the same write lock: no concurrent change can slip in.
          const orphaned = soleManagedWorkspaces(tx, input.userId, input.managingRoles);
          if (orphaned.length > 0) {
            throw new Abort({
              outcome: 'sole_workspace_manager',
              workspaces: orphaned.map((workspace) => ({ id: workspace.id as WorkspaceId, name: workspace.name })),
            });
          }

          const sessionsRevoked = revokeAllAccess(tx, input.userId, input.at);
          const recoveriesRevoked = tx
            .update(accountRecoveries)
            .set({ revokedAt: input.at })
            .where(
              and(
                eq(accountRecoveries.userId, input.userId),
                isNull(accountRecoveries.completedAt),
                isNull(accountRecoveries.revokedAt),
                gt(accountRecoveries.expiresAt, input.at),
              ),
            )
            .returning({ id: accountRecoveries.id })
            .all().length;
          // Links issued by a disabled (possibly compromised) admin must not outlive the decision.
          const invitationsRevoked = tx
            .update(invitations)
            .set({ revokedAt: input.at, revokedByUserId: actor.userId })
            .where(
              and(
                eq(invitations.invitedByUserId, input.userId),
                isNull(invitations.acceptedAt),
                isNull(invitations.revokedAt),
                gt(invitations.expiresAt, input.at),
              ),
            )
            .returning({ id: invitations.id })
            .all();
          for (const invitation of invitationsRevoked) {
            recordSecurityEvent(tx, {
              actor,
              type: 'INVITATION_REVOKED',
              subjectType: 'invitation',
              subjectId: invitation.id,
              occurredAt: input.at,
              metadata: { reason: 'issuer_disabled' },
            });
          }
          recordSecurityEvent(tx, {
            ...event,
            type: 'ACCOUNT_DISABLED',
            metadata: { sessionsRevoked, recoveriesRevoked, invitationsRevoked: invitationsRevoked.length },
          });
          return { outcome: 'ok', sessionsRevoked };
        }, IMMEDIATE);
      } catch (error) {
        if (error instanceof Abort) return error.result;
        throw error;
      }
    },
  };
}
