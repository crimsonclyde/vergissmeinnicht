/**
 * The Knot cannot be opened by this User: unknown, malformed, expired or revoked token, a target
 * that no longer exists, or a User without access to it. One error for all cases, so a token
 * reveals nothing about its target before authorization.
 */
export class KnotNotFoundError extends Error {
  constructor() {
    super('Knot not found');
    this.name = 'KnotNotFoundError';
  }
}

/** Management: unknown Knot id, or one of another Workspace. */
export class KnotRecordNotFoundError extends Error {
  constructor() {
    super('Knot not found');
    this.name = 'KnotRecordNotFoundError';
  }
}

export class KnotAlreadyRevokedError extends Error {
  constructor() {
    super('The Knot is already revoked');
    this.name = 'KnotAlreadyRevokedError';
  }
}

/** The Procedure or Run to link does not exist in this Workspace (or the Procedure is deleted). */
export class KnotTargetNotFoundError extends Error {
  constructor() {
    super('Knot target not found');
    this.name = 'KnotTargetNotFoundError';
  }
}

export class KnotLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its limit of active Knots');
    this.name = 'KnotLimitReachedError';
  }
}
