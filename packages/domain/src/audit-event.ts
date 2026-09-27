/**
 * Workspace content history: Procedure changes and Run events (Run and Step state changes follow
 * with Steps 5.2–5.5). Append-only, written in
 * the same transaction as the change it records. Account and access events use `security_events`.
 */
export const AUDIT_EVENT_TYPES = ['PROCEDURE_CREATED', 'PROCEDURE_UPDATED', 'PROCEDURE_DELETED', 'PROCEDURE_RESTORED', 'RUN_STARTED', 'STEP_STATE_CHANGED'] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
