-- Hand-written instead of drizzle-kit's table rebuild, which would drop the runs triggers from 0011.
-- All new columns start NULL; existing Runs are ACTIVE, which satisfies both checks.
ALTER TABLE `runs` ADD `ended_by_user_id` text REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE `runs` ADD `ended_by_display_name` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `ended_at` integer
	CONSTRAINT "runs_end_consistent" CHECK(("ended_at" is null) = ("state" = 'ACTIVE') and ("ended_at" is null) = ("ended_by_user_id" is null) and ("ended_at" is null) = ("ended_by_display_name" is null));
--> statement-breakpoint
ALTER TABLE `runs` ADD `end_reason` text
	CONSTRAINT "runs_end_reason_only_when_aborted" CHECK("end_reason" is null or ("state" = 'ABORTED' and length(trim("end_reason")) > 0 and length("end_reason") <= 500));
--> statement-breakpoint
-- A COMPLETED or ABORTED Run is history: no column may change any more, and it cannot be reopened
-- (docu/steps.md 5.6). Corrections would be a separate, additive, audited workflow.
CREATE TRIGGER `runs_finished_immutable`
BEFORE UPDATE ON `runs`
WHEN OLD.`state` <> 'ACTIVE'
BEGIN
	SELECT RAISE(ABORT, 'run is finished');
END;
