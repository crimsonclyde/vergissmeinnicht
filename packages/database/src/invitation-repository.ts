import { randomUUID } from 'node:crypto';
import { TransactionRollbackError, and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { InvitationAcceptance, InvitationRepository, NewInvitation } from '@vergissmeinnicht/application';
import type { Actor, Invitation, InvitationId, NormalizedEmail, UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { accounts, invitations, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';
import { toUser } from './user-repository.ts';

type InvitationRow = typeof invitations.$inferSelect;

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id as InvitationId,
    email: row.email as NormalizedEmail,
    grantsServerAdmin: row.grantsServerAdmin,
    invitedBy: (row.invitedByUserId ?? undefined) as UserId | undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
  };
}

const pending = (now: Date) =>
  and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now));

const actorUserId = (actor: Actor) => (actor.kind === 'user' ? actor.userId : null);

export function createInvitationRepository({ db }: Pick<AppDatabase, 'db'>): InvitationRepository {
  return {
    async issue(input: NewInvitation, actor: Actor) {
      return db.transaction((tx) => {
        const superseded = tx
          .update(invitations)
          .set({ revokedAt: input.createdAt, revokedByUserId: actorUserId(actor) })
          .where(
            and(
              pending(input.createdAt),
              actor.kind === 'system'
                ? or(eq(invitations.email, input.email), isNull(invitations.invitedByUserId))
                : eq(invitations.email, input.email),
            ),
          )
          .returning({ id: invitations.id })
          .all();
        for (const { id } of superseded) {
          recordSecurityEvent(tx, {
            type: 'INVITATION_SUPERSEDED',
            actor,
            subjectType: 'invitation',
            subjectId: id,
            occurredAt: input.createdAt,
          });
        }

        const row = tx
          .insert(invitations)
          .values({
            id: randomUUID(),
            email: input.email,
            tokenHash: input.tokenHash,
            grantsServerAdmin: input.grantsServerAdmin,
            invitedByUserId: actorUserId(actor),
            createdAt: input.createdAt,
            expiresAt: input.expiresAt,
          })
          .returning()
          .get();
        recordSecurityEvent(tx, {
          type: 'INVITATION_CREATED',
          actor,
          subjectType: 'invitation',
          subjectId: row.id,
          occurredAt: input.createdAt,
          metadata: { grantsServerAdmin: input.grantsServerAdmin, expiresAt: input.expiresAt.toISOString() },
        });
        return toInvitation(row);
      });
    },

    async revoke(id: InvitationId, actor: Actor, now: Date) {
      return db.transaction((tx) => {
        const updated = tx
          .update(invitations)
          .set({ revokedAt: now, revokedByUserId: actorUserId(actor) })
          .where(and(eq(invitations.id, id), pending(now)))
          .returning({ id: invitations.id })
          .all();
        if (updated.length === 0) return false;
        recordSecurityEvent(tx, {
          type: 'INVITATION_REVOKED',
          actor,
          subjectType: 'invitation',
          subjectId: id,
          occurredAt: now,
        });
        return true;
      });
    },

    async accept(input: InvitationAcceptance) {
      const at = input.acceptedAt;
      // IMMEDIATE takes the write lock before the first read, so concurrent acceptances (also from
      // other processes) are serialized; the conditional update below is a second guard.
      try {
        return db.transaction((tx) => {
          const invitation = tx
            .select()
            .from(invitations)
            .where(and(eq(invitations.tokenHash, input.tokenHash), pending(at)))
            .get();
          if (invitation === undefined) return undefined;
          const isBootstrap = invitation.invitedByUserId === null;
          if (isBootstrap && tx.select({ id: users.id }).from(users).where(eq(users.serverAdmin, true)).limit(1).get()) {
            return undefined;
          }
          if (tx.select({ id: users.id }).from(users).where(eq(users.email, invitation.email)).get()) {
            return undefined;
          }

          const user = tx
            .insert(users)
            .values({
              id: randomUUID(),
              email: invitation.email,
              name: input.displayName,
              // Possession of the link emailed to (or, for the bootstrap, printed for) this address.
              emailVerified: true,
              status: 'ACTIVE',
              serverAdmin: invitation.grantsServerAdmin,
              createdAt: at,
              updatedAt: at,
            })
            .returning()
            .get();
          tx.insert(accounts)
            .values({
              id: randomUUID(),
              accountId: user.id,
              providerId: 'credential',
              userId: user.id,
              password: input.passwordHash,
              createdAt: at,
              updatedAt: at,
            })
            .run();
          const claimed = tx
            .update(invitations)
            .set({ acceptedAt: at, acceptedUserId: user.id })
            .where(and(eq(invitations.id, invitation.id), pending(at)))
            .returning({ id: invitations.id })
            .all();
          if (claimed.length !== 1) {
            tx.rollback();
          }

          const actor: Actor = { kind: 'user', userId: user.id, displayName: user.name };
          recordSecurityEvent(tx, {
            type: 'INVITATION_ACCEPTED',
            actor,
            subjectType: 'invitation',
            subjectId: invitation.id,
            occurredAt: at,
          });
          recordSecurityEvent(tx, {
            type: 'USER_CREATED',
            actor,
            subjectType: 'user',
            subjectId: user.id,
            occurredAt: at,
            metadata: { invitationId: invitation.id, serverAdmin: user.serverAdmin },
          });
          return toUser(user);
        }, { behavior: 'immediate' });
      } catch (error) {
        if (error instanceof TransactionRollbackError) return undefined;
        throw error;
      }
    },

    async listPending(now: Date) {
      return db
        .select()
        .from(invitations)
        .where(pending(now))
        .orderBy(desc(invitations.createdAt))
        .all()
        .map(toInvitation);
    },

    async findById(id: InvitationId) {
      const row = db.select().from(invitations).where(eq(invitations.id, id)).get();
      return row && toInvitation(row);
    },

    async findByTokenHash(tokenHash: string) {
      const row = db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).get();
      return row && toInvitation(row);
    },
  };
}
