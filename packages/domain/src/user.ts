import { DomainValidationError } from './errors.ts';

/**
 * Stable internal User identity. Authentication methods (password, TOTP, future Apple/GitHub)
 * are linked to it; it never derives from an email address or an external provider subject.
 */
export type UserId = string & { readonly __brand: 'UserId' };

/** Trimmed, NFC-normalized, lower-cased email address. The unit of uniqueness and invite binding. */
export type NormalizedEmail = string & { readonly __brand: 'NormalizedEmail' };

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
const CONTROL_CHARS = /\p{Cc}/u;

/**
 * Normalizes an email address for storage, lookup and uniqueness. The whole address is
 * lower-cased so that case variants cannot create separate accounts or bypass invite binding.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  const email = input.trim().normalize('NFC').toLowerCase();
  if (CONTROL_CHARS.test(email) || !EMAIL_SHAPE.test(email)) {
    throw new DomainValidationError('email', 'invalid_email', 'Email address is not valid');
  }
  const localPart = email.slice(0, email.lastIndexOf('@'));
  if (email.length > MAX_EMAIL_LENGTH || localPart.length > MAX_EMAIL_LOCAL_PART_LENGTH) {
    throw new DomainValidationError('email', 'email_too_long', 'Email address is too long');
  }
  return email as NormalizedEmail;
}

export const MAX_DISPLAY_NAME_LENGTH = 80;
// Bidirectional overrides/isolates can make a name render as someone else's in audit history.
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/u;

/** Display names appear in audit snapshots, so they must render unambiguously. */
export function normalizeDisplayName(input: string): string {
  const name = input.trim().normalize('NFC');
  if (name.length === 0) {
    throw new DomainValidationError('displayName', 'display_name_empty', 'Display name is required');
  }
  if ([...name].length > MAX_DISPLAY_NAME_LENGTH) {
    throw new DomainValidationError('displayName', 'display_name_too_long', 'Display name is too long');
  }
  if (CONTROL_CHARS.test(name) || BIDI_CONTROLS.test(name)) {
    throw new DomainValidationError(
      'displayName',
      'display_name_invalid_characters',
      'Display name contains control characters',
    );
  }
  return name;
}

/** Only ACTIVE users may authenticate or act; DISABLED users keep their history but lose access. */
export function canAuthenticate(user: Pick<User, 'status'>): boolean {
  return user.status === 'ACTIVE';
}

/** Server-admin capabilities require an ACTIVE account; a disabled admin has no administrative power. */
export function isActiveServerAdmin(user: Pick<User, 'status' | 'serverAdmin'>): boolean {
  return canAuthenticate(user) && user.serverAdmin;
}
