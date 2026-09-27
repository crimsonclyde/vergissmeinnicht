-- Hand-written instead of drizzle-kit's table rebuild: rebuilding run_steps would drop the
-- immutability triggers from 0011. SQLite allows CHECK constraints (which may reference other
-- columns) on added columns; all new columns start NULL, which satisfies every check.
ALTER TABLE `run_steps` ADD `state_reason` text
	CONSTRAINT "run_steps_reason_only_when_skipped_or_na" CHECK("state_reason" is null or ("state" in ('SKIPPED', 'NOT_APPLICABLE') and length(trim("state_reason")) > 0 and length("state_reason") <= 500));
--> statement-breakpoint
ALTER TABLE `run_steps` ADD `state_changed_by_user_id` text REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE `run_steps` ADD `state_changed_by_display_name` text;
--> statement-breakpoint
ALTER TABLE `run_steps` ADD `state_changed_at` integer
	CONSTRAINT "run_steps_state_change_complete" CHECK(("state_changed_by_user_id" is null) = ("state_changed_by_display_name" is null) and ("state_changed_by_user_id" is null) = ("state_changed_at" is null));
--> statement-breakpoint
-- Execution state of a Run that is no longer ACTIVE cannot change (historical immutability, 5.6).
CREATE TRIGGER `run_steps_state_only_while_active`
BEFORE UPDATE OF `state`, `state_reason`, `state_changed_by_user_id`, `state_changed_by_display_name`, `state_changed_at` ON `run_steps`
WHEN (SELECT `state` FROM `runs` WHERE `id` = NEW.`run_id`) <> 'ACTIVE'
BEGIN
	SELECT RAISE(ABORT, 'run is not active');
END;
