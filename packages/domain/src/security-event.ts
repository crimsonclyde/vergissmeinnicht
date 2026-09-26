/**
 * Security-relevant account events (invitations, logins, MFA, recovery). Run/Step history uses
 * the separate Run AuditEvent model (Step 5.5). Security events are append-only.
 */
export const SECURITY_EVENT_TYPES = [
  'INVITATION_CREATED',
  'INVITATION_SUPERSEDED',
  'INVITATION_REVOKED',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Who caused an event: an authenticated User, or a named operator/system channel such as the CLI. */
export type Actor =
  | { readonly kind: 'user'; readonly userId: string; readonly displayName: string }
  | { readonly kind: 'system'; readonly label: SystemActorLabel };

export type SystemActorLabel = 'cli:admin-bootstrap';
