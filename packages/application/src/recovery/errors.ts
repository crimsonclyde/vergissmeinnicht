/** Unknown, malformed, expired, superseded or used recovery link: one generic failure. */
export class InvalidRecoveryError extends Error {
  constructor() {
    super('Recovery link is invalid or has expired');
    this.name = 'InvalidRecoveryError';
  }
}

/** No account with this email (only reported to authorized server admins). */
export class UnknownAccountError extends Error {
  constructor() {
    super('No account with this email address');
    this.name = 'UnknownAccountError';
  }
}

/** Recovery is only possible for ACTIVE accounts. */
export class AccountNotActiveError extends Error {
  constructor() {
    super('The account is not active');
    this.name = 'AccountNotActiveError';
  }
}

/** The recovery would reset TOTP, but the account has none. */
export class NothingToRecoverError extends Error {
  constructor() {
    super('The account has no two-factor authentication to reset');
    this.name = 'NothingToRecoverError';
  }
}
