import type { Actor, Invitation, InvitationId, NormalizedEmail } from '@vergissmeinnicht/domain';

export interface NewInvitation {
  readonly email: NormalizedEmail;
  readonly tokenHash: string;
  readonly grantsServerAdmin: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Every mutating method commits its state change together with the matching security
 * events (INVITATION_CREATED / _SUPERSEDED / _REVOKED) in one transaction.
 */
export interface InvitationRepository {
  /**
   * Revokes still-pending invitations for the same email (and, for a bootstrap, every pending
   * bootstrap invitation so at most one admin-granting CLI link exists), then stores the new one.
   */
  issue(invitation: NewInvitation, actor: Actor): Promise<Invitation>;
  /** Returns false when the invitation is no longer pending (accepted, revoked or expired). */
  revoke(id: InvitationId, actor: Actor, now: Date): Promise<boolean>;
  findById(id: InvitationId): Promise<Invitation | undefined>;
  findByTokenHash(tokenHash: string): Promise<Invitation | undefined>;
}
