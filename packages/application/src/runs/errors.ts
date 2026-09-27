/** Unknown Run, or one belonging to another Workspace. */
export class RunNotFoundError extends Error {
  constructor() {
    super('Run not found');
    this.name = 'RunNotFoundError';
  }
}

/** A Run needs at least one Step to execute. */
export class ProcedureHasNoStepsError extends Error {
  constructor() {
    super('The Procedure has no Steps');
    this.name = 'ProcedureHasNoStepsError';
  }
}

export class RunLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its limit of active Runs');
    this.name = 'RunLimitReachedError';
  }
}
