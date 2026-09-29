import { DomainValidationError } from './errors.ts';

/**
 * NIST SP 800-63B-4: at least 15 characters when a password is the only authentication factor.
 * TOTP is optional in V1, so every password must meet the single-factor minimum.
 */
export const MIN_PASSWORD_LENGTH = 15;
/** Upper bound for the password hasher's input; Better Auth enforces the same limit at sign-in. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Screens a candidate against known common/breached passwords (13.3). Implemented offline in the
 * infrastructure (a bundled list — passwords never leave the server); receives the comparison form.
 */
export interface CommonPasswordList {
  has(comparisonForm: string): boolean;
}

/** Words an attacker would try first: the service itself (the account's email and name are added per user). */
export const SERVICE_WORDS: readonly string[] = ['vergissmeinnicht', 'vergiss mein nicht', 'forget me not', 'forgetmenot', 'vmn'];

/** A password built from context words must still carry at least this much of its own (code points). */
const MIN_OWN_CHARACTERS = 8;

/**
 * How passwords are compared with the list and with context words: NFKC (as the hasher uses it),
 * lower case, without white space — "Correct Horse Battery Staple" matches "correcthorsebatterystaple".
 */
export function passwordComparisonForm(password: string): string {
  return password.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm', 'qwertzuiopasdfghjklyxcvbnm', 'azertyuiopqsdfghjklmwxcvbn', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p'];

/** One short unit repeated ("aaaa…", "abcabc…", "1212…") or a run along the alphabet/digits/keyboard. */
function isPatterned(form: string): boolean {
  const chars = [...form];
  for (let unit = 1; unit <= 4; unit++) {
    if (chars.every((char, index) => char === chars[index % unit])) return true;
  }
  const cycled = (sequence: string) => sequence.repeat(Math.ceil((form.length * 2) / sequence.length) + 2);
  return SEQUENCES.some((sequence) => cycled(sequence).includes(form) || cycled([...sequence].reverse().join('')).includes(form));
}

/** True when, after removing every context word, fewer than MIN_OWN_CHARACTERS remain. */
function isMostlyContext(form: string, context: readonly string[]): boolean {
  const words = [...new Set(context.map(passwordComparisonForm).filter((word) => [...word].length >= 3))].sort((a, b) => b.length - a.length);
  if (words.length === 0) return false;
  let rest = form;
  for (const word of words) rest = rest.split(word).join('');
  if (rest === form) return false;
  return [...rest.replace(/[^\p{L}\p{N}]/gu, '')].length < MIN_OWN_CHARACTERS;
}

/**
 * Validates a newly chosen password. Length is counted in Unicode code points for the minimum
 * (a passphrase of emoji or CJK characters is not penalized) and in UTF-16 units for the maximum
 * (matching Better Auth's check). No composition rules, per current NIST guidance (SP 800-63B-4):
 * instead the password must not be a known common/breached password, a repetitive or sequential
 * pattern, or made mostly of context words (the service name, the account's email or display name).
 */
export function validateNewPassword(password: string, screen: { readonly common: CommonPasswordList; readonly context: readonly string[] }): void {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new DomainValidationError('password', 'password_too_short', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new DomainValidationError('password', 'password_too_long', `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  const form = passwordComparisonForm(password);
  if (screen.common.has(form)) {
    throw new DomainValidationError('password', 'password_too_common', 'Password is on the list of common or breached passwords');
  }
  if (isPatterned(form) || isMostlyContext(form, [...SERVICE_WORDS, ...screen.context])) {
    throw new DomainValidationError('password', 'password_too_predictable', 'Password is a simple pattern or made of names from this account or service');
  }
}

/** Context words of an account: the email (whole and local part) and the display name. */
export function passwordContextOf(account: { readonly email: string; readonly displayName: string }): string[] {
  const local = account.email.split('@')[0] ?? '';
  return [account.email, local, ...local.split(/[._+-]+/u), account.displayName, ...account.displayName.split(/\s+/u)];
}
