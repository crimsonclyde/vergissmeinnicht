import { DomainValidationError } from './errors.ts';

/**
 * NIST SP 800-63B-4: at least 15 characters when a password is the only authentication factor.
 * TOTP is optional in V1, so every password must meet the single-factor minimum.
 */
export const MIN_PASSWORD_LENGTH = 15;
/** Upper bound for the password hasher's input; Better Auth enforces the same limit at sign-in. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Validates a newly chosen password. Length is counted in Unicode code points for the minimum
 * (a passphrase of emoji or CJK characters is not penalized) and in UTF-16 units for the maximum
 * (matching Better Auth's check). No composition rules, per current NIST guidance.
 */
export function validateNewPassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new DomainValidationError('password', 'password_too_short', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new DomainValidationError('password', 'password_too_long', `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}
