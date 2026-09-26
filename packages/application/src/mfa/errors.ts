/** The current password given for a sensitive account change was wrong. */
export class ReauthenticationFailedError extends Error {
  constructor() {
    super('Re-authentication failed');
    this.name = 'ReauthenticationFailedError';
  }
}

/** Wrong, malformed, replayed or unusable TOTP or recovery code. */
export class InvalidMfaCodeError extends Error {
  constructor() {
    super('Invalid code');
    this.name = 'InvalidMfaCodeError';
  }
}

/** Too many consecutive wrong TOTP codes; recovery codes still work. */
export class TotpLockedError extends Error {
  constructor() {
    super('TOTP verification is temporarily locked');
    this.name = 'TotpLockedError';
  }
}

/** Unknown, expired, exhausted or used sign-in challenge: the password must be entered again. */
export class MfaChallengeInvalidError extends Error {
  constructor() {
    super('Sign-in challenge is invalid or has expired');
    this.name = 'MfaChallengeInvalidError';
  }
}

export class TotpAlreadyEnabledError extends Error {
  constructor() {
    super('TOTP is already enabled');
    this.name = 'TotpAlreadyEnabledError';
  }
}

export class TotpNotEnabledError extends Error {
  constructor() {
    super('TOTP is not enabled');
    this.name = 'TotpNotEnabledError';
  }
}

/** No unexpired enrollment to confirm. */
export class NoPendingEnrollmentError extends Error {
  constructor() {
    super('No pending TOTP enrollment');
    this.name = 'NoPendingEnrollmentError';
  }
}
