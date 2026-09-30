/** Unknown Schedule or Occurrence, or one of another Workspace: all look the same. */
export class ScheduleNotFoundError extends Error {
  constructor() {
    super('Schedule or occurrence not found');
    this.name = 'ScheduleNotFoundError';
  }
}

/** Someone else changed the Schedule since the caller loaded it. */
export class ScheduleConflictError extends Error {
  constructor() {
    super('The scheduled item was changed in the meantime');
    this.name = 'ScheduleConflictError';
  }
}

/** The Schedule has ended, or the Occurrence is no longer in a state that allows this (e.g. already completed). */
export class ScheduleClosedError extends Error {
  constructor() {
    super('The schedule or occurrence was already completed, skipped, started or ended');
    this.name = 'ScheduleClosedError';
  }
}

export class ScheduleLimitReachedError extends Error {
  constructor() {
    super('The Workspace has reached its limit of schedules');
    this.name = 'ScheduleLimitReachedError';
  }
}

/** The Procedure of a Schedule was deleted: its Occurrences cannot be started (nothing runs silently). */
export class ScheduledProcedureUnavailableError extends Error {
  constructor() {
    super('The Procedure of this scheduled item was deleted');
    this.name = 'ScheduledProcedureUnavailableError';
  }
}

/** The Assignee is not an active member who can see the Workspace's Procedures (assignment grants nothing). */
export class InvalidAssigneeError extends Error {
  constructor() {
    super('The Assignee must be a member of the Workspace');
    this.name = 'InvalidAssigneeError';
  }
}

/** The action does not apply here (e.g. Complete on a Procedure Occurrence, or changing a one-time item into a series). */
export class WrongScheduleKindError extends Error {
  constructor() {
    super('This action does not apply to this kind of Schedule');
    this.name = 'WrongScheduleKindError';
  }
}

/** Reopen refused: the next Occurrence of a completion-based series was already acted on. */
export class NextOccurrenceInUseError extends Error {
  constructor() {
    super('The next occurrence was already acted on');
    this.name = 'NextOccurrenceInUseError';
  }
}

/** Another Occurrence of the Schedule is already due on that date. */
export class OccurrenceDateTakenError extends Error {
  constructor() {
    super('Another occurrence is due on that date');
    this.name = 'OccurrenceDateTakenError';
  }
}

/** The Run cannot be linked (other Procedure or Workspace, aborted, already linked, or too old; D7). */
export class RunNotEligibleError extends Error {
  constructor() {
    super('This Run cannot be linked to the occurrence');
    this.name = 'RunNotEligibleError';
  }
}
