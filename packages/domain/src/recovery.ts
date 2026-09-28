import type { UserId } from './user.ts';

export type AccountRecoveryId = string & { readonly __brand: 'AccountRecoveryId' };

/** Recovery links are short-lived: they are delivered to the user's own mailbox and used right away. */
export const ACCOUNT_RECOVERY_TTL_MS = 60 * 60_000;

/**
 * An admin-initiated (or CLI-initiated) recovery of one account. The token only exists in the link
 * sent to the account's email address (or printed for the operator); only its hash is stored.
 */
export interface AccountRecovery {
  readonly id: AccountRecoveryId;
  readonly userId: UserId;
  readonly resetPassword: boolean;
  readonly resetTotp: boolean;
  /** `undefined` when issued by the operator CLI. */
  readonly issuedBy: UserId | undefined;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly completedAt: Date | undefined;
  readonly revokedAt: Date | undefined;
}

export function isAccountRecoveryPending(recovery: AccountRecovery, now: Date): boolean {
  return (
    recovery.completedAt === undefined &&
    recovery.revokedAt === undefined &&
    now.getTime() < recovery.expiresAt.getTime()
  );
}

/**
 * Without a new password the user proves the current one, so a TOTP-only reset still needs two
 * things: the link (mailbox) and the password.
 */
export function recoveryRequiresCurrentPassword(recovery: Pick<AccountRecovery, 'resetPassword'>): boolean {
  return !recovery.resetPassword;
}
