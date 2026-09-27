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

/** Unknown Step, or one that belongs to another Run. */
export class RunStepNotFoundError extends Error {
  constructor() {
    super('Step not found');
    this.name = 'RunStepNotFoundError';
  }
}

/** Completed or aborted Runs are history; their Steps cannot change. */
export class RunNotActiveError extends Error {
  constructor() {
    super('The Run is not active');
    this.name = 'RunNotActiveError';
  }
}

/** Someone else changed the Step since the caller last saw it. */
export class StepStateConflictError extends Error {
  constructor() {
    super('The Step was changed in the meantime');
    this.name = 'StepStateConflictError';
  }
}

/** Required Steps are still PENDING or SKIPPED; the Run cannot be completed (it can be aborted). */
export class RunIncompleteError extends Error {
  readonly openRequiredSteps: number;

  constructor(openRequiredSteps: number) {
    super('Required Steps are still open');
    this.name = 'RunIncompleteError';
    this.openRequiredSteps = openRequiredSteps;
  }
}
