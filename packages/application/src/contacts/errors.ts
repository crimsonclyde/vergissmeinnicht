/** Unknown Contact, one of another Workspace, or one in Trash. */
export class ContactNotFoundError extends Error {
  constructor() {
    super('Contact not found');
    this.name = 'ContactNotFoundError';
  }
}

/** The Contact was changed by someone else meanwhile: reload before changing it. */
export class ContactConflictError extends Error {
  constructor() {
    super('The contact was changed meanwhile');
    this.name = 'ContactConflictError';
  }
}

/** The Workspace holds as many Contacts as it can, or the Contact has as many links as it can. */
export class ContactLimitReachedError extends Error {
  constructor() {
    super('Contact limit reached');
    this.name = 'ContactLimitReachedError';
  }
}

/** A file that is not a usable CSV or vCard file at all: too large, too many contacts, undecodable, malformed. */
export class ContactImportRefusedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Contact import refused: ${code}`);
    this.name = 'ContactImportRefusedError';
    this.code = code;
  }
}
