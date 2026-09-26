import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { InvitationRepository, NewInvitation } from '@vergissmeinnicht/application';
import type { Actor, Invitation, InvitationId, NormalizedEmail, UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { invitations } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

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
