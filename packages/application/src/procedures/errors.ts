/** Unknown, soft-deleted, or belonging to another Workspace: all look the same. */
export class ProcedureNotFoundError extends Error {
  constructor() {
    super('Procedure not found');
    this.name = 'ProcedureNotFoundError';
  }
}

/** The Procedure was changed by someone else since the caller loaded it. */
export class ProcedureConflictError extends Error {
  constructor() {
    super('The Procedure was changed in the meantime');
    this.name = 'ProcedureConflictError';
  }
}

export class ProcedureLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its Procedure limit');
    this.name = 'ProcedureLimitReachedError';
  }
}

/** The save names a Section or Step id that does not belong to this Procedure. */
export class InvalidProcedureReferenceError extends Error {
  constructor() {
    super('The Procedure structure references unknown items');
    this.name = 'InvalidProcedureReferenceError';
  }
}
