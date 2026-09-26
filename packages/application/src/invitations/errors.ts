/** The actor lacks the capability. Deliberately says nothing about the target. */
export class NotAuthorizedError extends Error {
  constructor() {
    super('Not authorized');
    this.name = 'NotAuthorizedError';
  }
}

/** Unknown, malformed, expired, revoked or used: callers see one generic failure. */
export class InvalidInvitationError extends Error {
  constructor() {
    super('Invitation is invalid or has expired');
    this.name = 'InvalidInvitationError';
  }
}

export class InvitationNotRevocableError extends Error {
  constructor() {
    super('Invitation is no longer pending');
    this.name = 'InvitationNotRevocableError';
  }
}

export class AccountAlreadyExistsError extends Error {
  constructor() {
    super('An account with this email already exists');
    this.name = 'AccountAlreadyExistsError';
  }
}

export class BootstrapNotAllowedError extends Error {
  constructor() {
    super('A server admin already exists; bootstrap is disabled');
    this.name = 'BootstrapNotAllowedError';
  }
}
