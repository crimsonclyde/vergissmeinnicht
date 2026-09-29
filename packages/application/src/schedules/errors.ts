/** Unknown scheduled item, or one of another Workspace: both look the same. */
export class ScheduleNotFoundError extends Error {
  constructor() {
    super('Scheduled item not found');
    this.name = 'ScheduleNotFoundError';
  }
}

/** Someone else changed the scheduled item since the caller loaded it. */
export class ScheduleConflictError extends Error {
  constructor() {
    super('The scheduled item was changed in the meantime');
    this.name = 'ScheduleConflictError';
  }
}

/** The item was already started or cancelled; it only documents what happened. */
export class ScheduleClosedError extends Error {
  constructor() {
    super('The scheduled item was already started or cancelled');
    this.name = 'ScheduleClosedError';
  }
}

export class ScheduleLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its limit of scheduled items');
    this.name = 'ScheduleLimitReachedError';
  }
}

/** The source Procedure of a scheduled item was deleted: it cannot be started (nothing runs silently). */
export class ScheduledProcedureUnavailableError extends Error {
  constructor() {
    super('The Procedure of this scheduled item was deleted');
    this.name = 'ScheduledProcedureUnavailableError';
  }
}
