/**
 * Security-relevant account and access events (invitations, logins, MFA, recovery, Workspace
 * creation and Membership/role changes). Run/Step history uses
 * the separate Run AuditEvent model (Step 5.5). Security events are append-only.
 */
export const SECURITY_EVENT_TYPES = [
  'INVITATION_CREATED',
  'INVITATION_SUPERSEDED',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
  'USER_CREATED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'MFA_CHALLENGE_STARTED',
  'TOTP_CODE_REJECTED',
  'TOTP_ENROLLMENT_STARTED',
  'TOTP_ENABLED',
  'TOTP_DISABLED',
  'TOTP_LOCKED',
  'RECOVERY_CODE_USED',
  'RECOVERY_CODES_REGENERATED',
  'ACCOUNT_RECOVERY_ISSUED',
  'ACCOUNT_RECOVERY_SUPERSEDED',
  'ACCOUNT_RECOVERY_COMPLETED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'TOTP_RESET',
  'ACCOUNT_DISABLED',
  'ACCOUNT_ENABLED',
  'INSTANCE_SETTINGS_CHANGED',
  // Notifications (13.7): provider configuration (never the credential) and a person's Telegram chat.
  'NOTIFICATION_PROVIDER_CHANGED',
  'TELEGRAM_CONNECTED',
  'TELEGRAM_DISCONNECTED',
  'WORKSPACE_CREATED',
  'WORKSPACE_RENAMED',
  'MEMBERSHIP_ADDED',
  'MEMBERSHIP_ROLE_CHANGED',
  'MEMBERSHIP_REMOVED',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Who caused an event: an authenticated User, or a named operator/system channel such as the CLI. */
export type Actor =
  | { readonly kind: 'user'; readonly userId: string; readonly displayName: string }
  | { readonly kind: 'system'; readonly label: SystemActorLabel };

/**
 * `cli:admin-bootstrap` / `cli:admin-recover`: operator CLIs. `anonymous`: an unauthenticated request,
 * e.g. a failed login attempt against an existing account.
 */
export type SystemActorLabel = 'cli:admin-bootstrap' | 'cli:admin-recover' | 'anonymous';
