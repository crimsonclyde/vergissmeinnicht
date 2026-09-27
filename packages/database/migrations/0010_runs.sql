CREATE TABLE `run_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_section_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_sections_id_uuid" CHECK(length("run_sections"."id") = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_sections_position_unique` ON `run_sections` (`run_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_sections_id_run_unique` ON `run_sections` (`id`,`run_id`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`run_section_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_step_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`icon` text,
	`required` integer NOT NULL,
	`critical` integer NOT NULL,
	`skip_reason_policy` text NOT NULL,
	`not_applicable_reason_policy` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_section_id`,`run_id`) REFERENCES `run_sections`(`id`,`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_steps_id_uuid" CHECK(length("run_steps"."id") = 36),
	CONSTRAINT "run_steps_kind_valid" CHECK(kind in ('CHECK')),
	CONSTRAINT "run_steps_icon_valid" CHECK(icon is null or icon in ('checklist', 'home', 'kitchen', 'cleaning', 'laundry', 'garden', 'pet', 'car', 'travel', 'tools', 'health', 'shopping', 'document', 'security', 'star')),
	CONSTRAINT "run_steps_skip_policy_valid" CHECK(skip_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "run_steps_na_policy_valid" CHECK(not_applicable_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "run_steps_state_valid" CHECK(state in ('PENDING', 'DONE', 'SKIPPED', 'NOT_APPLICABLE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_steps_position_unique` ON `run_steps` (`run_section_id`,`position`);--> statement-breakpoint
CREATE INDEX `run_steps_run_idx` ON `run_steps` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`procedure_id` text NOT NULL,
	`procedure_revision` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`tags` text NOT NULL,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_by_display_name` text NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_id_uuid" CHECK(length("runs"."id") = 36),
	CONSTRAINT "runs_state_valid" CHECK(state in ('ACTIVE', 'COMPLETED', 'ABORTED')),
	CONSTRAINT "runs_icon_valid" CHECK(icon in ('checklist', 'home', 'kitchen', 'cleaning', 'laundry', 'garden', 'pet', 'car', 'travel', 'tools', 'health', 'shopping', 'document', 'security', 'star')),
	CONSTRAINT "runs_title_present" CHECK(length(trim("runs"."title")) > 0 and length("runs"."title") <= 120),
	CONSTRAINT "runs_tags_array" CHECK(json_valid("runs"."tags") and json_type("runs"."tags") = 'array'),
	CONSTRAINT "runs_revisions_positive" CHECK("runs"."procedure_revision" >= 1 and "runs"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `runs_workspace_state_idx` ON `runs` (`workspace_id`,`state`,`started_at`);--> statement-breakpoint
CREATE INDEX `runs_procedure_idx` ON `runs` (`procedure_id`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `run_id` text REFERENCES runs(id);--> statement-breakpoint
CREATE INDEX `audit_events_run_idx` ON `audit_events` (`run_id`);