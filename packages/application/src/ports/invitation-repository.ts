import type { Actor, Invitation, InvitationId, NormalizedEmail, User } from '@vergissmeinnicht/domain';

export interface NewInvitation {
  readonly email: NormalizedEmail;
  readonly tokenHash: string;
  readonly grantsServerAdmin: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface InvitationAcceptance {
  readonly tokenHash: string;
  readonly displayName: string;
  /** Output of the PasswordHasher; the plaintext password never reaches persistence. */
  readonly passwordHash: string;
  readonly acceptedAt: Date;
}

/**
 * Every mutating method commits its state change together with the matching security
 * events (INVITATION_CREATED / _SUPERSEDED / _REVOKED / _ACCEPTED, USER_CREATED) in one transaction.
 */
export interface InvitationRepository {
  /**
   * Revokes still-pending invitations for the same email (and, for a bootstrap, every pending
   * bootstrap invitation so at most one admin-granting CLI link exists), then stores the new one.
   */
  issue(invitation: NewInvitation, actor: Actor): Promise<Invitation>;
  /** Returns false when the invitation is no longer pending (accepted, revoked or expired). */
  revoke(id: InvitationId, actor: Actor, now: Date): Promise<boolean>;
  /**
   * In one transaction: re-checks that the invitation is still pending (and, for a CLI bootstrap
   * invitation, that no server admin exists yet), creates the User with a verified email and the
   * invitation's server-admin grant, stores the password credential and marks the invitation
   * accepted. Returns `undefined` if any check fails; nothing is written in that case.
   * Concurrent acceptances of the same invitation yield at most one User.
   */
  accept(acceptance: InvitationAcceptance): Promise<User | undefined>;
  /** Pending (not accepted, revoked or expired) invitations, newest first. */
  listPending(now: Date): Promise<Invitation[]>;
  findById(id: InvitationId): Promise<Invitation | undefined>;
  findByTokenHash(tokenHash: string): Promise<Invitation | undefined>;
}
