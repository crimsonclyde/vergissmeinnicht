import type { AuditEvent } from '@vergissmeinnicht/domain';

/** History entry for clients: the actor's display-name snapshot, not their internal user id. */
export function auditEventView(event: AuditEvent) {
  return {
    id: event.id,
    type: event.type,
    at: event.occurredAt.toISOString(),
    actor: event.actor.displayName,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    metadata: event.metadata,
  };
}
