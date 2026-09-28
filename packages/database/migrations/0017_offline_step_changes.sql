-- Hand-written instead of drizzle-kit's table rebuild, which would drop the run_steps immutability
-- triggers (0011, 0012). Offline Step changes (8.5): the device clock of a queued change, and a
-- client-chosen change id so a change sent twice is applied once.
ALTER TABLE `run_steps` ADD `state_changed_device_at` integer
	CONSTRAINT "run_steps_device_time_with_change" CHECK("state_changed_device_at" is null or "state_changed_at" is not null);
--> statement-breakpoint
-- The device time is execution state as well: frozen once the Run is no longer ACTIVE.
DROP TRIGGER `run_steps_state_only_while_active`;
--> statement-breakpoint
CREATE TRIGGER `run_steps_state_only_while_active`
BEFORE UPDATE OF `state`, `state_reason`, `state_changed_by_user_id`, `state_changed_by_display_name`, `state_changed_at`, `state_changed_device_at` ON `run_steps`
WHEN (SELECT `state` FROM `runs` WHERE `id` = NEW.`run_id`) <> 'ACTIVE'
BEGIN
	SELECT RAISE(ABORT, 'run is not active');
END;
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `client_change_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_client_change_unique` ON `audit_events` (`actor_user_id`,`client_change_id`) WHERE "audit_events"."client_change_id" is not null;
