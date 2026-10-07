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
  // Optional tools of a Workspace (16.2): switched on or off by a Workspace admin.
  'WORKSPACE_TOOL_ENABLED',
  'WORKSPACE_TOOL_DISABLED',
  // Documents (16.2): changes only — previews and downloads are not events. Never file contents or notes.
  'FOLDER_CREATED',
  'FOLDER_RENAMED',
  'FOLDER_MOVED',
  'FOLDER_DELETED',
  'FOLDER_RESTORED',
  'DOCUMENT_CREATED',
  'DOCUMENT_UPDATED',
  'DOCUMENT_FILES_CHANGED',
  'DOCUMENT_MOVED',
  'DOCUMENT_DELETED',
  'DOCUMENT_RESTORED',
  'DOCUMENT_TYPE_CREATED',
  'DOCUMENT_TYPE_RENAMED',
  'DOCUMENT_TYPE_RETIRED',
  // Documents (16.4): permanent deletion from Trash by a Workspace admin (ids, titles, counts — never
  // content), a bulk export (who, what scope, how much), and the Workspace's own storage limit.
  'DOCUMENT_PURGED',
  'FOLDER_PURGED',
  'DOCUMENTS_EXPORTED',
  'WORKSPACE_STORAGE_LIMIT_CHANGED',
  // Text recognition (16.9, P5): switched on or off for the Workspace by a Workspace admin. Recognised
  // text itself is derived data, never an event.
  'TEXT_RECOGNITION_ENABLED',
  'TEXT_RECOGNITION_DISABLED',
  // A person corrected a file's recognised text, or restored the recognised text (16.13): who, when,
  // the Document and the file — never the text.
  'DOCUMENT_TEXT_CORRECTED',
  'DOCUMENT_TEXT_RESTORED',
  // Links (16.5): a Document linked to a Procedure, a Schedule or another Document; and a Document
  // version retained for a Run (recorded with the Run's id — an addition beside the Run, never a change to it).
  'DOCUMENT_LINK_ADDED',
  'DOCUMENT_LINK_REMOVED',
  'RUN_DOCUMENT_LINKED',
  'RUN_DOCUMENT_UNLINKED',
  // A Document version removed from a finished Run by a Workspace admin (P4): who, when and why — nothing of the document.
  'RUN_DOCUMENT_REMOVED',
  // Contacts (16.6). A Contact is personal data of a third party, and history is never rewritten — so
  // these events carry the Contact's id and counts, **never a name, address or number**: after a
  // permanent deletion nothing of the person is left in the history.
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONTACT_DELETED',
  'CONTACT_RESTORED',
  'CONTACT_PURGED',
  'CONTACTS_IMPORTED',
  'CONTACTS_EXPORTED',
  'CONTACT_LINK_ADDED',
  'CONTACT_LINK_REMOVED',
  // Maintenance (16.7): a record and its status, always set by a person. Titles and statuses — never
  // the description, the cost or the name of the responsible Contact.
  'MAINTENANCE_CREATED',
  'MAINTENANCE_UPDATED',
  'MAINTENANCE_STATUS_CHANGED',
  'MAINTENANCE_DELETED',
  'MAINTENANCE_RESTORED',
  'MAINTENANCE_PURGED',
  'MAINTENANCE_LINK_ADDED',
  'MAINTENANCE_LINK_REMOVED',
  'EQUIPMENT_CREATED', 'EQUIPMENT_UPDATED', 'EQUIPMENT_DELETED', 'EQUIPMENT_RESTORED', 'EQUIPMENT_PURGED', 'EQUIPMENT_LINK_ADDED', 'EQUIPMENT_LINK_REMOVED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditSubjectType = 'procedure' | 'run' | 'run_step' | 'knot' | 'schedule' | 'occurrence' | 'list' | 'workspace' | 'folder' | 'document' | 'document_type' | 'contact' | 'maintenance' | 'equipment';

/** A recorded event as read back for history views. */
export interface AuditEvent {
  readonly id: string;
  readonly type: AuditEventType;
  readonly occurredAt: Date;
  /** Internal id plus the display name at the time of the event. */
  readonly actor: { readonly userId: string; readonly displayName: string };
  readonly subjectType: AuditSubjectType;
  readonly subjectId: string;
  readonly runId: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}
