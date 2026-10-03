-- Audit events are append-only: history is never rewritten or removed by the application.
-- Corrections must be recorded as new events (docs/development/security.md §6).
CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events is append-only');
END;
