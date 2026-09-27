/**
 * Workspace content history (Procedures now; Runs and Steps with Step 5.5). Append-only, written in
 * the same transaction as the change it records. Account and access events use `security_events`.
 */
export const AUDIT_EVENT_TYPES = ['PROCEDURE_CREATED', 'PROCEDURE_UPDATED', 'PROCEDURE_DELETED', 'PROCEDURE_RESTORED'] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
