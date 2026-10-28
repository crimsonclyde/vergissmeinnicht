/** Encouragement, never a permission, rank, streak or financial reward. Server UTC days. */
export const DAILY_PROGRESS_LIMIT = 100;
export function progressPoints(type: string, metadata: Readonly<Record<string, unknown>> = {}): number {
  switch (type) {
    case 'EQUIPMENT_CREATED': case 'PROCEDURE_CREATED': return 10;
    case 'BRING_CREATED': case 'DOCUMENT_CREATED': case 'CONTACT_CREATED': case 'SCHEDULE_CREATED': case 'JOURNAL_CREATED': return 5;
    case 'RUN_COMPLETED': return 20;
    case 'OCCURRENCE_COMPLETED': return metadata.via === 'run' ? 0 : 10;
    case 'STEP_STATE_CHANGED': return metadata.to === 'DONE' ? 1 : 0;
    case 'MAINTENANCE_STATUS_CHANGED': return metadata.to === 'COMPLETED' ? 10 : 0;
    case 'BRING_COMPLETED': return 10;
    case 'LIST_ITEM_CHECKED': return 1;
    default: return 0;
  }
}
