import { describe, expect, it } from 'vitest';
import { invitationState, isActiveServerAdmin, type Invitation, type InvitationId, type NormalizedEmail } from './index.ts';

const base: Invitation = {
  id: 'inv' as InvitationId,
  email: 'alice@example.org' as NormalizedEmail,
  grantsServerAdmin: false,
  invitedBy: undefined,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2026-01-04T00:00:00Z'),
  acceptedAt: undefined,
  revokedAt: undefined,
};

describe('invitationState', () => {
  it('is PENDING before expiry', () => {
    expect(invitationState(base, new Date('2026-01-03T23:59:59Z'))).toBe('PENDING');
  });

  it('is EXPIRED at and after the expiry instant', () => {
    expect(invitationState(base, new Date('2026-01-04T00:00:00Z'))).toBe('EXPIRED');
  });

  it('reports REVOKED and ACCEPTED regardless of time', () => {
    const at = new Date('2026-01-02T00:00:00Z');
    expect(invitationState({ ...base, revokedAt: at }, at)).toBe('REVOKED');
    expect(invitationState({ ...base, acceptedAt: at }, new Date('2030-01-01'))).toBe('ACCEPTED');
  });
});

describe('isActiveServerAdmin', () => {
  it('requires both the flag and an ACTIVE account', () => {
    expect(isActiveServerAdmin({ serverAdmin: true, status: 'ACTIVE' })).toBe(true);
    expect(isActiveServerAdmin({ serverAdmin: true, status: 'DISABLED' })).toBe(false);
    expect(isActiveServerAdmin({ serverAdmin: false, status: 'ACTIVE' })).toBe(false);
  });
});
