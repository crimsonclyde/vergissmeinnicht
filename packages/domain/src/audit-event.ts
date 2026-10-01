/**
 * Workspace content history: Procedure changes and Run events (Run and Step state changes follow
 * with Steps 5.2–5.5). Append-only, written in
 * the same transaction as the change it records. Account and access events use `security_events`.
 */
export const AUDIT_EVENT_TYPES = [
  'PROCEDURE_CREATED',
  'PROCEDURE_UPDATED',
  'PROCEDURE_DELETED',
  'PROCEDURE_RESTORED',
  'RUN_STARTED',
  'STEP_STATE_CHANGED',
  'RUN_COMPLETED',
  'RUN_ABORTED',
  'KNOT_CREATED',
  'KNOT_REVOKED',
  // Scheduled Procedures (13.4): the intention only — never evidence of execution. Starting one is RUN_STARTED.
  'SCHEDULE_CREATED',
  'SCHEDULE_CHANGED',
  'SCHEDULE_CANCELLED',
  // Schedules and Occurrences (14.1): intentions, completion of Reminders and the link to Runs.
  'SCHEDULE_PAUSED',
  'SCHEDULE_RESUMED',
  'SCHEDULE_ENDED',
  'SCHEDULE_ASSIGNED',
  'OCCURRENCE_COMPLETED',
  'OCCURRENCE_REOPENED',
  'OCCURRENCE_SKIPPED',
  'OCCURRENCE_MOVED',
  'OCCURRENCE_ASSIGNED',
  'OCCURRENCE_RUN_LINKED',
  'OCCURRENCE_RUN_UNLINKED',
  // Lists (15.3): the List itself only. Items carry who added and who checked them; they have no events.
  'LIST_CREATED',
  'LIST_RENAMED',
  'LIST_DELETED',
  'LIST_RESTORED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** A recorded event as read back for history views. */
export interface AuditEvent {
  readonly id: string;
  readonly type: AuditEventType;
  readonly occurredAt: Date;
  /** Internal id plus the display name at the time of the event. */
  readonly actor: { readonly userId: string; readonly displayName: string };
  readonly subjectType: 'procedure' | 'run' | 'run_step' | 'knot' | 'schedule' | 'occurrence' | 'list';
  readonly subjectId: string;
  readonly runId: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}
