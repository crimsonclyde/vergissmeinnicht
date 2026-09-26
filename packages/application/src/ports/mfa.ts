import type { Actor, UserId } from '@vergissmeinnicht/domain';

/** A user's TOTP credential. `enabledAt === undefined` means an unconfirmed enrollment. */
export interface TotpCredential {
  readonly userId: UserId;
  /** Sealed by the SecretBox; the plaintext secret never reaches persistence. */
  readonly sealedSecret: string;
  readonly createdAt: Date;
  readonly enabledAt: Date | undefined;
  /** Highest TOTP time step ever accepted; codes for this or earlier steps are replays. */
  readonly lastUsedStep: number;
  readonly consecutiveFailures: number;
  readonly lockedUntil: Date | undefined;
}

/**
 * TOTP credentials and recovery codes. Every mutating method writes its security event(s) in the
 * same transaction as the state change.
 */
export interface TotpRepository {
  find(userId: UserId): Promise<TotpCredential | undefined>;
  /** Stores (or replaces) an unconfirmed enrollment. Returns false if TOTP is already enabled. */
  savePendingEnrollment(userId: UserId, sealedSecret: string, now: Date, actor: Actor): Promise<boolean>;
  /**
   * Confirms the pending enrollment created at `pendingCreatedAt` (so a concurrently replaced
   * enrollment cannot be confirmed with a code for the old secret), records `step` as used and
   * stores the recovery code hashes. Returns false if nothing matched.
   */
  enable(input: {
    readonly userId: UserId;
    readonly pendingCreatedAt: Date;
    readonly step: number;
    readonly recoveryCodeHashes: readonly string[];
    readonly now: Date;
    readonly actor: Actor;
  }): Promise<boolean>;
  /** Atomically accepts `step` if it is newer than the last used one; resets the failure count. */
  acceptStep(userId: UserId, step: number): Promise<boolean>;
  /** Counts a wrong or replayed TOTP code (TOTP_CODE_REJECTED); applies the domain lock policy (TOTP_LOCKED) when due. */
  recordFailure(userId: UserId, now: Date, actor: Actor): Promise<void>;
  /** Marks one unused recovery code as used. Returns the number left, or undefined if none matched. */
  consumeRecoveryCode(userId: UserId, codeHash: string, now: Date, actor: Actor): Promise<number | undefined>;
  /** Replaces all recovery codes of an enabled credential. Returns false if TOTP is not enabled. */
  replaceRecoveryCodes(userId: UserId, codeHashes: readonly string[], now: Date, actor: Actor): Promise<boolean>;
  /** Deletes the credential and all recovery codes. Returns false if TOTP was not enabled. */
  disable(userId: UserId, now: Date, actor: Actor): Promise<boolean>;
  remainingRecoveryCodes(userId: UserId): Promise<number>;
}

export interface MfaChallenge {
  readonly id: string;
  readonly userId: UserId;
  readonly attempts: number;
}

/** Pending sign-ins: the password was correct, the second factor is outstanding. */
export interface MfaChallengeRepository {
  /** Also records MFA_CHALLENGE_STARTED. */
  create(
    input: { readonly tokenHash: string; readonly userId: UserId; readonly createdAt: Date; readonly expiresAt: Date },
    actor: Actor,
  ): Promise<void>;
  /** Unexpired, unconsumed challenge with attempts left. */
  findActive(tokenHash: string, now: Date): Promise<MfaChallenge | undefined>;
  /** Uses up one attempt. Returns false if the challenge is no longer active or out of attempts. */
  recordAttempt(id: string, now: Date): Promise<boolean>;
  /** Single use: returns true only for the first successful call. */
  consume(id: string, now: Date): Promise<boolean>;
}

/** Authenticated encryption for secrets that must be recoverable (TOTP seeds). */
export interface SecretBox {
  /** `context` is bound as associated data: a sealed value only opens in the same context. */
  seal(plaintext: string, context: string): string;
  /** Returns undefined for tampered, foreign-context or undecryptable values. */
  open(sealed: string, context: string): string | undefined;
}

export interface TotpAlgorithm {
  /** New random secret, base32-encoded. */
  generateSecret(): string;
  provisioningUri(secret: string, account: string): string;
  /** Returns the matched time step within the allowed window, or undefined. `code` is 6 ASCII digits. */
  matchStep(secret: string, code: string, now: Date): number | undefined;
}

export interface RecoveryCodes {
  /** Fresh high-entropy codes (shown once) and the hashes to store. */
  generate(count: number): { readonly codes: readonly string[]; readonly hashes: readonly string[] };
  /** Normalizes user input and hashes it; undefined if it cannot be a recovery code. */
  hash(input: string): string | undefined;
}

/** Re-authentication: checks a user's current password. */
export interface PasswordCheck {
  verify(userId: UserId, password: string): Promise<boolean>;
}
