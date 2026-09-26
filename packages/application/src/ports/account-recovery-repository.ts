import type { AccountRecovery, AccountRecoveryId, Actor, UserId } from '@vergissmeinnicht/domain';

export interface NewAccountRecovery {
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly resetPassword: boolean;
  readonly resetTotp: boolean;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface AccountRecoveryRepository {
  /** Supersedes the user's pending recoveries, stores the new one (ACCOUNT_RECOVERY_ISSUED / _SUPERSEDED). */
  issue(recovery: NewAccountRecovery, actor: Actor): Promise<AccountRecovery>;
  findByTokenHash(tokenHash: string): Promise<AccountRecovery | undefined>;
  /**
   * In one transaction: claims the still-pending recovery (single use), replaces the password
   * hash if given, removes the TOTP credential and recovery codes if the recovery resets TOTP,
   * invalidates pending sign-in challenges, revokes all sessions of the user and records
   * ACCOUNT_RECOVERY_COMPLETED + PASSWORD_RESET / TOTP_RESET. Returns false if nothing was claimed.
   */
  complete(input: {
    readonly id: AccountRecoveryId;
    readonly passwordHash: string | undefined;
    readonly now: Date;
    readonly actor: Actor;
  }): Promise<boolean>;
}

export interface CredentialRepository {
  /**
   * Replaces the password hash and revokes every session of the user in one transaction
   * (PASSWORD_CHANGED). Returns false if the user has no password credential.
   */
  changePassword(userId: UserId, passwordHash: string, now: Date, actor: Actor): Promise<boolean>;
}
