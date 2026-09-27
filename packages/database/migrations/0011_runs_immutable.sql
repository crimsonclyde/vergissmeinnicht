-- Runs are historical records (AGENTS.md "Procedure vs Run", docu/security.md §6): the snapshot taken
-- at start is immutable and Runs are never deleted. Only execution state (`runs.state`,
-- `runs.revision`, `run_steps.state` and state columns added later) may change.
CREATE TRIGGER `runs_snapshot_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `procedure_id`, `procedure_revision`, `title`, `description`, `icon`, `tags`,
	`started_by_user_id`, `started_by_display_name`, `started_at` ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'run snapshot is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_no_delete`
BEFORE DELETE ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'runs are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `run_sections_immutable`
BEFORE UPDATE ON `run_sections`
BEGIN
	SELECT RAISE(ABORT, 'run snapshot is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `run_sections_no_delete`
BEFORE DELETE ON `run_sections`
BEGIN
	SELECT RAISE(ABORT, 'runs are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `run_steps_snapshot_immutable`
BEFORE UPDATE OF `id`, `run_id`, `run_section_id`, `position`, `source_step_id`, `kind`, `title`, `description`, `icon`,
	`required`, `critical`, `skip_reason_policy`, `not_applicable_reason_policy` ON `run_steps`
BEGIN
	SELECT RAISE(ABORT, 'run snapshot is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `run_steps_no_delete`
BEFORE DELETE ON `run_steps`
BEGIN
	SELECT RAISE(ABORT, 'runs are never deleted');
END;
