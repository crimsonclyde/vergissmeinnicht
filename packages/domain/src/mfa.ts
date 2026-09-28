/**
 * TOTP (RFC 6238) parameters. SHA-1 / 6 digits / 30 s is what every authenticator app supports;
 * the security margin comes from the 160-bit secret, replay protection and attempt limits.
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Accepted clock drift in time steps on each side (±30 s). */
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

/** An unconfirmed enrollment (secret shown, no valid code yet) expires after this long. */
export const TOTP_ENROLLMENT_TTL_MS = 10 * 60_000;

/** A pending sign-in (password verified, TOTP outstanding) expires after this long. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
/** Wrong codes per sign-in challenge before the password has to be entered again. */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

export const RECOVERY_CODE_COUNT = 10;

/** Consecutive wrong TOTP codes per account before a temporary lock (NIST SP 800-63B §5.2.2). */
export const TOTP_LOCK_THRESHOLD = 10;
const TOTP_LOCK_BASE_MS = 15 * 60_000;
const TOTP_LOCK_MAX_MS = 24 * 3_600_000;

/**
 * Lock duration after `consecutiveFailures` wrong TOTP codes: none below the threshold, then
 * 15 min doubling with every further block of failures, capped at 24 h. Bounds online guessing
 * to a few dozen codes per day even for an attacker who knows the password. Recovery codes are
 * not subject to the lock (they cannot be guessed), so the owner can still sign in.
 */
export function totpLockDurationMs(consecutiveFailures: number): number {
  if (consecutiveFailures < TOTP_LOCK_THRESHOLD || consecutiveFailures % TOTP_LOCK_THRESHOLD !== 0) return 0;
  const blocks = consecutiveFailures / TOTP_LOCK_THRESHOLD;
  return Math.min(TOTP_LOCK_BASE_MS * 2 ** (blocks - 1), TOTP_LOCK_MAX_MS);
}

/** What stands between a verified password and a full session for a given account. */
export interface MfaState {
  readonly totpEnabled: boolean;
}

/**
 * The central MFA policy (docu/security.md §13). V1: a second factor is required exactly when the
 * user enabled TOTP. A later enforcement rule (e.g. server admins must use TOTP) changes this
 * function only.
 */
export function requiresTotpChallenge(state: MfaState): boolean {
  return state.totpEnabled;
}

const TOTP_CODE = /^[0-9]{6}$/;

/** Accepts only exactly six ASCII digits (surrounding whitespace and inner spaces are removed). */
export function normalizeTotpCode(input: string): string | undefined {
  const code = input.replace(/\s+/g, '');
  return TOTP_CODE.test(code) ? code : undefined;
}
