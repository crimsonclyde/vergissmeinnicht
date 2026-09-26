-- Security events are append-only: history is never rewritten or removed by the application.
-- Corrections must be recorded as new events (docu/security.md §6).
CREATE TRIGGER `security_events_no_update`
BEFORE UPDATE ON `security_events`
BEGIN
	SELECT RAISE(ABORT, 'security_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `security_events_no_delete`
BEFORE DELETE ON `security_events`
BEGIN
	SELECT RAISE(ABORT, 'security_events is append-only');
END;
