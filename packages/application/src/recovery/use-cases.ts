import {
  ACCOUNT_RECOVERY_TTL_MS,
  canAuthenticate,
  isAccountRecoveryPending,
  isActiveServerAdmin,
  normalizeEmail,
  recoveryRequiresCurrentPassword,
  validateNewPassword,
  type AccountRecovery,
  type Actor,
  type User,
} from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { ReauthenticationFailedError } from '../mfa/errors.ts';
import { mfaStatus, verifyStepUp, type MfaDeps, type SecondFactor } from '../mfa/use-cases.ts';
import type { AccountRecoveryRepository, CredentialRepository } from '../ports/account-recovery-repository.ts';
import type { Clock } from '../ports/clock.ts';
import type { EmailMessage, EmailSender } from '../ports/email-sender.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type { PasswordHasher } from '../ports/password-hasher.ts';
import type { UserRepository } from '../ports/user-repository.ts';
import { AccountNotActiveError, InvalidRecoveryError, NothingToRecoverError, UnknownAccountError } from './errors.ts';

export interface RecoveryDeps {
  readonly users: UserRepository;
  readonly recoveries: AccountRecoveryRepository;
  readonly credentials: CredentialRepository;
  /** For step-up of the acting admin, TOTP status of the target and current-password checks. */
  readonly mfa: MfaDeps;
  readonly tokens: InvitationTokens;
  readonly passwordHasher: PasswordHasher;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly publicOrigin: string;
}

export interface RecoveryScope {
  readonly resetPassword: boolean;
  readonly resetTotp: boolean;
}

const userActor = (user: User): Actor => ({ kind: 'user', userId: user.id, displayName: user.displayName });

export function recoveryUrl(publicOrigin: string, token: string): string {
  // Token in the path, never in the query string.
  return `${publicOrigin}/recover/${token}`;
}

function recoveryEmail(target: User, scope: RecoveryScope, url: string, expiresAt: Date, adminName: string): EmailMessage {
  const what = [scope.resetPassword && 'choose a new password', scope.resetTotp && 'remove your two-factor authentication']
    .filter(Boolean)
    .join(' and ');
  return {
    to: target.email,
    subject: 'VergissMeinNicht account recovery',
    text: [
      `Hello ${target.displayName},`,
      ``,
      `${adminName} started a recovery of your VergissMeinNicht account. Open this link to ${what}:`,
      url,
      ``,
      `The link can be used once and expires on ${expiresAt.toISOString()}.`,
      scope.resetPassword ? '' : 'You will need your current password to complete it.',
      `If you did not ask for this, do not open the link and contact your administrator.`,
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n'),
  };
}

async function createRecovery(
  deps: RecoveryDeps,
  target: User,
  scope: RecoveryScope,
  actor: Actor,
): Promise<{ recovery: AccountRecovery; token: string }> {
  if (!canAuthenticate(target)) throw new AccountNotActiveError();
  if (scope.resetTotp && !(await mfaStatus(deps.mfa, target)).totpEnabled) throw new NothingToRecoverError();
  const now = deps.clock.now();
  const { token, hash } = deps.tokens.generate();
  const recovery = await deps.recoveries.issue(
    {
      userId: target.id,
      tokenHash: hash,
      ...scope,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ACCOUNT_RECOVERY_TTL_MS),
    },
    actor,
  );
  return { recovery, token };
}

/**
 * A server admin starts the recovery of another account. Requires step-up (the admin's password,
 * plus TOTP if enabled). The link is emailed to the account's own address and never returned, so
 * the admin (or a stolen admin session) cannot use it.
 */
export async function issueAccountRecovery(
  deps: RecoveryDeps,
  input: {
    readonly admin: User;
    readonly adminPassword: string;
    readonly adminFactor: SecondFactor | undefined;
    readonly email: string;
    readonly scope: RecoveryScope;
  },
): Promise<{ recovery: AccountRecovery; delivery: 'sent' | 'failed' }> {
  if (!isActiveServerAdmin(input.admin)) throw new NotAuthorizedError();
  await verifyStepUp(deps.mfa, { user: input.admin, password: input.adminPassword, factor: input.adminFactor });
  const target = await deps.users.findByEmail(normalizeEmail(input.email));
  if (target === undefined) throw new UnknownAccountError();
  // Own credentials are changed in account settings, never through the admin path.
  if (target.id === input.admin.id) throw new NotAuthorizedError();

  const { recovery, token } = await createRecovery(deps, target, input.scope, userActor(input.admin));
  try {
    await deps.email.send(
      recoveryEmail(target, input.scope, recoveryUrl(deps.publicOrigin, token), recovery.expiresAt, input.admin.displayName),
    );
    return { recovery, delivery: 'sent' };
  } catch {
    return { recovery, delivery: 'failed' };
  }
}

/**
 * Operator CLI for when no admin can act (e.g. the only server admin lost their authenticator).
 * Shell access with the production configuration already implies full control of the server.
 */
export async function issueOperatorRecovery(
  deps: RecoveryDeps,
  input: { readonly email: string; readonly scope: RecoveryScope },
): Promise<{ recovery: AccountRecovery; url: string }> {
  const target = await deps.users.findByEmail(normalizeEmail(input.email));
  if (target === undefined) throw new UnknownAccountError();
  const { recovery, token } = await createRecovery(deps, target, input.scope, { kind: 'system', label: 'cli:admin-recover' });
  return { recovery, url: recoveryUrl(deps.publicOrigin, token) };
}

async function pendingRecovery(deps: RecoveryDeps, token: string): Promise<{ recovery: AccountRecovery; user: User }> {
  const hash = deps.tokens.hash(token);
  const recovery = hash === undefined ? undefined : await deps.recoveries.findByTokenHash(hash);
  const user = recovery === undefined ? undefined : await deps.users.findById(recovery.userId);
  if (
    recovery === undefined ||
    user === undefined ||
    !canAuthenticate(user) ||
    !isAccountRecoveryPending(recovery, deps.clock.now())
  ) {
    throw new InvalidRecoveryError();
  }
  return { recovery, user };
}

/** For the `/recover/{token}` page. Every failure is the same InvalidRecoveryError. */
export async function resolveAccountRecovery(deps: RecoveryDeps, token: string) {
  const { recovery, user } = await pendingRecovery(deps, token);
  return {
    email: user.email,
    resetPassword: recovery.resetPassword,
    resetTotp: recovery.resetTotp,
    requiresCurrentPassword: recoveryRequiresCurrentPassword(recovery),
    expiresAt: recovery.expiresAt,
  };
}

/**
 * The account owner completes the recovery. Revokes every session of the user; does not sign in.
 * A new password is validated before anything is hashed or written.
 */
export async function completeAccountRecovery(
  deps: RecoveryDeps,
  input: { readonly token: string; readonly newPassword?: string | undefined; readonly currentPassword?: string | undefined },
): Promise<void> {
  const { recovery, user } = await pendingRecovery(deps, input.token);
  let passwordHash: string | undefined;
  if (recovery.resetPassword) {
    validateNewPassword(input.newPassword ?? '');
    passwordHash = await deps.passwordHasher.hash(input.newPassword ?? '');
  } else if (input.currentPassword === undefined || !(await deps.mfa.passwords.verify(user.id, input.currentPassword))) {
    throw new ReauthenticationFailedError();
  }
  const completed = await deps.recoveries.complete({
    id: recovery.id,
    passwordHash,
    now: deps.clock.now(),
    actor: userActor(user),
  });
  if (!completed) throw new InvalidRecoveryError();
}

/** Self-service password change. The caller replaces the current session afterwards. */
export async function changePassword(
  deps: RecoveryDeps,
  input: { readonly user: User; readonly currentPassword: string; readonly newPassword: string },
): Promise<void> {
  if (!canAuthenticate(input.user) || !(await deps.mfa.passwords.verify(input.user.id, input.currentPassword))) {
    throw new ReauthenticationFailedError();
  }
  validateNewPassword(input.newPassword);
  const hash = await deps.passwordHasher.hash(input.newPassword);
  if (!(await deps.credentials.changePassword(input.user.id, hash, deps.clock.now(), userActor(input.user)))) {
    throw new ReauthenticationFailedError();
  }
}
