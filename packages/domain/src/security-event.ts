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
  // Image storage quota of a Workspace changed by a server admin (14.3).
  'WORKSPACE_IMAGE_QUOTA_CHANGED',
  // The storage ceiling of a Workspace changed by a server admin (16.4; replaces the image quota).
  'WORKSPACE_STORAGE_CEILING_CHANGED',
  // Notifications (13.7): provider configuration (never the credential) and a person's Telegram chat.
  'NOTIFICATION_PROVIDER_CHANGED',
  'TELEGRAM_CONNECTED',
  'TELEGRAM_DISCONNECTED',
  // Weather (19.4): the server's weather settings changed by a server admin (switch, allowed providers, MET contact).
  'WEATHER_SETTINGS_CHANGED',
  // A weather provider credential set, replaced or removed (19.4b) — server-wide or personal; never the value.
  'WEATHER_CREDENTIAL_CHANGED',
  'WORKSPACE_CREATED',
  // Section 18: a Workspace backup made (who asked, size, counts) and downloaded — never its content.
  'WORKSPACE_BACKUP_EXPORTED',
  'WORKSPACE_BACKUP_DOWNLOADED',
  'WORKSPACE_RESTORE_UPLOADED',
  'WORKSPACE_RESTORED',
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
