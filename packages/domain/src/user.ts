import { DomainValidationError } from './errors.ts';
import { INVISIBLE_OR_INVALID_CHARS, normalizeSingleLineName } from './text.ts';

/**
 * Stable internal User identity. Authentication methods (password, TOTP, future Apple/GitHub)
 * are linked to it; it never derives from an email address or an external provider subject.
 */
export type UserId = string & { readonly __brand: 'UserId' };

/** Trimmed, NFC-normalized, lower-cased email address. The unit of uniqueness and invite binding. */
export type NormalizedEmail = string & { readonly __brand: 'NormalizedEmail' };

/**
 * `IMPORTED` (section 18): a historical identity from a restored Workspace backup — a name in history, never an
 * account: no sign-in, credentials, recovery, invitations, notifications or memberships, enforced by the
 * application and by the database (`users_imported_identity`, triggers in migration 0045).
 */
export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'IMPORTED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
/** What a server admin may set on an account: never `IMPORTED` (and never on an `IMPORTED` identity). */
export const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
/** The reserved address domain of historical identities (`.invalid` never resolves, RFC 2606). */
export const IMPORTED_EMAIL_DOMAIN = 'imported.invalid';
/**
 * The restore upload limit (section 18, D4): 20 GB by default; server admins choose between 100 MB and 1 TB.
 * Also bounded by a trigger (migration 0046). Packages are streamed — the bound protects the volume, not memory.
 */
export const WORKSPACE_RESTORE_BYTES_RANGE = Object.freeze({ min: 100_000_000, max: 1_000_000_000_000 });
export const DEFAULT_WORKSPACE_RESTORE_MAX_BYTES = 20_000_000_000;
export function parseWorkspaceRestoreMaxBytes(bytes: number): number {
  if (!Number.isInteger(bytes) || bytes < WORKSPACE_RESTORE_BYTES_RANGE.min || bytes > WORKSPACE_RESTORE_BYTES_RANGE.max) {
    throw new DomainValidationError('workspaceRestoreMaxBytes', 'invalid_restore_limit', 'Choose a limit between 100 MB and 1 TB');
  }
  return bytes;
}
export const isImportedIdentity = (user: { readonly status: UserStatus }): boolean => user.status === 'IMPORTED';

export interface User {
  readonly id: UserId;
  readonly email: NormalizedEmail;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly status: UserStatus;
  /** Server-wide administration (invitations, recovery, disabling accounts). Independent of Workspace roles. */
  readonly serverAdmin: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseUserId(value: string): UserId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('userId', 'invalid_user_id', 'User id must be a lower-case UUIDv4');
  }
  return value as UserId;
}

export const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_LOCAL_PART_LENGTH = 64;
// Pragmatic shape check; ownership is proven by the invitation email, not by syntax.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/**
 * Normalizes an email address for storage, lookup and uniqueness. The whole address is
 * lower-cased so that case variants cannot create separate accounts or bypass invite binding.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  const email = input.trim().normalize('NFC').toLowerCase();
  // Invisible or broken characters would create an address that looks like another one (a look-alike
  // account, or one nobody can type to sign in).
  if (INVISIBLE_OR_INVALID_CHARS.test(email) || !EMAIL_SHAPE.test(email)) {
    throw new DomainValidationError('email', 'invalid_email', 'Email address is not valid');
  }
  const localPart = email.slice(0, email.lastIndexOf('@'));
  if (email.length > MAX_EMAIL_LENGTH || localPart.length > MAX_EMAIL_LOCAL_PART_LENGTH) {
    throw new DomainValidationError('email', 'email_too_long', 'Email address is too long');
  }
  return email as NormalizedEmail;
}

export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Display names appear in audit snapshots, so they must render unambiguously. */
export function normalizeDisplayName(input: string): string {
  return normalizeSingleLineName(input, {
    field: 'displayName',
    codePrefix: 'display_name',
    label: 'Display name',
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });
}

/** Only ACTIVE users may authenticate or act; DISABLED users keep their history but lose access. */
export function canAuthenticate(user: Pick<User, 'status'>): boolean {
  return user.status === 'ACTIVE';
}

/** Server-admin capabilities require an ACTIVE account; a disabled admin has no administrative power. */
export function isActiveServerAdmin(user: Pick<User, 'status' | 'serverAdmin'>): boolean {
  return canAuthenticate(user) && user.serverAdmin;
}
