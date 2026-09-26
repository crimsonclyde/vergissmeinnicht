import {
  MFA_CHALLENGE_TTL_MS,
  RECOVERY_CODE_COUNT,
  TOTP_ENROLLMENT_TTL_MS,
  canAuthenticate,
  normalizeTotpCode,
  requiresTotpChallenge,
  type Actor,
  type User,
} from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type {
  MfaChallengeRepository,
  PasswordCheck,
  RecoveryCodes,
  SecretBox,
  TotpAlgorithm,
  TotpCredential,
  TotpRepository,
} from '../ports/mfa.ts';
import type { UserRepository } from '../ports/user-repository.ts';
import {
  InvalidMfaCodeError,
  MfaChallengeInvalidError,
  NoPendingEnrollmentError,
  ReauthenticationFailedError,
  TotpAlreadyEnabledError,
  TotpLockedError,
  TotpNotEnabledError,
} from './errors.ts';

export interface MfaDeps {
  readonly users: UserRepository;
  readonly totp: TotpRepository;
  readonly challenges: MfaChallengeRepository;
  readonly secretBox: SecretBox;
  readonly algorithm: TotpAlgorithm;
  readonly recoveryCodes: RecoveryCodes;
  /** 256-bit opaque tokens with hash-only storage (same scheme as invitation links). */
  readonly challengeTokens: InvitationTokens;
  readonly passwords: PasswordCheck;
  readonly clock: Clock;
}

/** A second factor as submitted by the user: exactly one of the two. */
export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };
export type SecondFactorMethod = 'totp' | 'recovery_code';

const userActor = (user: User): Actor => ({ kind: 'user', userId: user.id, displayName: user.displayName });
const secretContext = (user: Pick<User, 'id'>) => `totp-secret:${user.id}`;
const isEnabled = (credential: TotpCredential | undefined): credential is TotpCredential =>
  credential?.enabledAt !== undefined;

async function reauthenticate(deps: MfaDeps, user: User, password: string): Promise<void> {
  if (!canAuthenticate(user) || !(await deps.passwords.verify(user.id, password))) {
    throw new ReauthenticationFailedError();
  }
}

/** Central decision used by sign-in: does this account need the TOTP challenge? */
export async function requiresSecondFactor(deps: MfaDeps, user: User): Promise<boolean> {
  return requiresTotpChallenge({ totpEnabled: isEnabled(await deps.totp.find(user.id)) });
}

export async function mfaStatus(deps: MfaDeps, user: User) {
  const credential = await deps.totp.find(user.id);
  return {
    totpEnabled: isEnabled(credential),
    recoveryCodesRemaining: isEnabled(credential) ? await deps.totp.remainingRecoveryCodes(user.id) : 0,
  };
}

/**
 * Step 1 of enrollment: requires the current password; returns a new secret (shown once) and its
 * provisioning URI. Nothing changes for sign-in until the user proves a valid code (step 2).
 */
export async function startTotpEnrollment(
  deps: MfaDeps,
  input: { readonly user: User; readonly password: string },
): Promise<{ secret: string; uri: string }> {
  await reauthenticate(deps, input.user, input.password);
  if (isEnabled(await deps.totp.find(input.user.id))) throw new TotpAlreadyEnabledError();
  const secret = deps.algorithm.generateSecret();
  const saved = await deps.totp.savePendingEnrollment(
    input.user.id,
    deps.secretBox.seal(secret, secretContext(input.user)),
    deps.clock.now(),
    userActor(input.user),
  );
  if (!saved) throw new TotpAlreadyEnabledError();
  return { secret, uri: deps.algorithm.provisioningUri(secret, input.user.email) };
}

/** Step 2 of enrollment: a valid code activates TOTP and yields recovery codes (shown once). */
export async function confirmTotpEnrollment(
  deps: MfaDeps,
  input: { readonly user: User; readonly code: string },
): Promise<{ recoveryCodes: readonly string[] }> {
  const now = deps.clock.now();
  const credential = await deps.totp.find(input.user.id);
  if (
    credential === undefined ||
    credential.enabledAt !== undefined ||
    now.getTime() - credential.createdAt.getTime() >= TOTP_ENROLLMENT_TTL_MS
  ) {
    throw new NoPendingEnrollmentError();
  }
  const step = matchCode(deps, input.user, credential, input.code, now);
  if (step === undefined) throw new InvalidMfaCodeError();

  const { codes, hashes } = deps.recoveryCodes.generate(RECOVERY_CODE_COUNT);
  const enabled = await deps.totp.enable({
    userId: input.user.id,
    pendingCreatedAt: credential.createdAt,
    step,
    recoveryCodeHashes: hashes,
    now,
    actor: userActor(input.user),
  });
  if (!enabled) throw new NoPendingEnrollmentError();
  return { recoveryCodes: codes };
}

function matchCode(deps: MfaDeps, user: User, credential: TotpCredential, input: string, now: Date) {
  const code = normalizeTotpCode(input);
  const secret = deps.secretBox.open(credential.sealedSecret, secretContext(user));
  return code === undefined || secret === undefined ? undefined : deps.algorithm.matchStep(secret, code, now);
}

/**
 * Verifies a TOTP code (lock, replay protection, failure counting) or consumes a recovery code.
 * Recovery codes bypass the TOTP lock: they cannot be guessed and let the owner in during an attack.
 */
async function verifySecondFactor(
  deps: MfaDeps,
  user: User,
  credential: TotpCredential,
  factor: SecondFactor,
): Promise<SecondFactorMethod> {
  const now = deps.clock.now();
  const actor = userActor(user);
  if ('recoveryCode' in factor) {
    const hash = deps.recoveryCodes.hash(factor.recoveryCode);
    if (hash === undefined || (await deps.totp.consumeRecoveryCode(user.id, hash, now, actor)) === undefined) {
      throw new InvalidMfaCodeError();
    }
    return 'recovery_code';
  }
  if (credential.lockedUntil !== undefined && credential.lockedUntil.getTime() > now.getTime()) {
    throw new TotpLockedError();
  }
  const step = matchCode(deps, user, credential, factor.code, now);
  if (step === undefined || !(await deps.totp.acceptStep(user.id, step))) {
    await deps.totp.recordFailure(user.id, now, actor);
    throw new InvalidMfaCodeError();
  }
  return 'totp';
}

/** Requires the current password and a valid TOTP or recovery code (downgrade protection). */
export async function disableTotp(
  deps: MfaDeps,
  input: { readonly user: User; readonly password: string; readonly factor: SecondFactor },
): Promise<void> {
  await reauthenticate(deps, input.user, input.password);
  const credential = await deps.totp.find(input.user.id);
  if (!isEnabled(credential)) throw new TotpNotEnabledError();
  await verifySecondFactor(deps, input.user, credential, input.factor);
  if (!(await deps.totp.disable(input.user.id, deps.clock.now(), userActor(input.user)))) {
    throw new TotpNotEnabledError();
  }
}

/** Requires the current password. Invalidates all previous recovery codes. */
export async function regenerateRecoveryCodes(
  deps: MfaDeps,
  input: { readonly user: User; readonly password: string },
): Promise<{ recoveryCodes: readonly string[] }> {
  await reauthenticate(deps, input.user, input.password);
  if (!isEnabled(await deps.totp.find(input.user.id))) throw new TotpNotEnabledError();
  const { codes, hashes } = deps.recoveryCodes.generate(RECOVERY_CODE_COUNT);
  if (!(await deps.totp.replaceRecoveryCodes(input.user.id, hashes, deps.clock.now(), userActor(input.user)))) {
    throw new TotpNotEnabledError();
  }
  return { recoveryCodes: codes };
}

/**
 * Called after the password was verified for an account that requires TOTP. Returns the raw
 * challenge token for the client (cookie); only its hash is stored. No session exists yet.
 */
export async function beginMfaChallenge(deps: MfaDeps, user: User): Promise<string> {
  const now = deps.clock.now();
  const { token, hash } = deps.challengeTokens.generate();
  await deps.challenges.create(
    { tokenHash: hash, userId: user.id, createdAt: now, expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS) },
    userActor(user),
  );
  return token;
}

/**
 * Completes a pending sign-in. Every attempt consumes one of the challenge's attempts; on success
 * the challenge is consumed (single use) and the caller issues a new, full session.
 */
export async function completeMfaChallenge(
  deps: MfaDeps,
  input: { readonly token: string; readonly factor: SecondFactor },
): Promise<{ user: User; method: SecondFactorMethod }> {
  const now = deps.clock.now();
  const hash = deps.challengeTokens.hash(input.token);
  const challenge = hash === undefined ? undefined : await deps.challenges.findActive(hash, now);
  if (challenge === undefined) throw new MfaChallengeInvalidError();
  const user = await deps.users.findById(challenge.userId);
  const credential = user === undefined ? undefined : await deps.totp.find(user.id);
  if (user === undefined || !canAuthenticate(user) || !isEnabled(credential)) {
    await deps.challenges.consume(challenge.id, now);
    throw new MfaChallengeInvalidError();
  }
  if (!(await deps.challenges.recordAttempt(challenge.id, now))) throw new MfaChallengeInvalidError();

  const method = await verifySecondFactor(deps, user, credential, input.factor);
  if (!(await deps.challenges.consume(challenge.id, now))) throw new MfaChallengeInvalidError();
  return { user, method };
}
