/**
 * Workspace content history: Procedure changes and Run events (Run and Step state changes follow
 * with Steps 5.2–5.5). Append-only, written in
 * the same transaction as the change it records. Account and access events use `security_events`.
 */
export const AUDIT_EVENT_TYPES = ['PROCEDURE_CREATED', 'PROCEDURE_UPDATED', 'PROCEDURE_DELETED', 'PROCEDURE_RESTORED', 'RUN_STARTED', 'STEP_STATE_CHANGED', 'RUN_COMPLETED', 'RUN_ABORTED', 'KNOT_CREATED', 'KNOT_REVOKED'] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** A recorded event as read back for history views. */
export interface AuditEvent {
  readonly id: string;
  readonly type: AuditEventType;
  readonly occurredAt: Date;
  /** Internal id plus the display name at the time of the event. */
  readonly actor: { readonly userId: string; readonly displayName: string };
  readonly subjectType: 'procedure' | 'run' | 'run_step' | 'knot';
  readonly subjectId: string;
  readonly runId: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}
