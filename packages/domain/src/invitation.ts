import type { NormalizedEmail, UserId } from './user.ts';

export type InvitationId = string & { readonly __brand: 'InvitationId' };

/**
 * An invitation binds account creation to one normalized email address. Its token is never
 * stored or modelled here; only a hash exists in persistence.
 */
export interface Invitation {
  readonly id: InvitationId;
  readonly email: NormalizedEmail;
  readonly grantsServerAdmin: boolean;
  /** `undefined` when issued by the one-time CLI bootstrap. */
  readonly invitedBy: UserId | undefined;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | undefined;
  readonly revokedAt: Date | undefined;
}

export type InvitationState = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export function invitationState(invitation: Invitation, now: Date): InvitationState {
  if (invitation.acceptedAt !== undefined) return 'ACCEPTED';
  if (invitation.revokedAt !== undefined) return 'REVOKED';
  if (now.getTime() >= invitation.expiresAt.getTime()) return 'EXPIRED';
  return 'PENDING';
}
