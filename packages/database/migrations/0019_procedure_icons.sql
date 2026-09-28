-- Icons move from CHECK constraints into a reference table (0.1.0-beta.4): new icons are then a row,
-- not a table rebuild. Hand-written (SQLite's table-rebuild procedure): each table is rebuilt with its
-- definition unchanged except that the icon CHECK is replaced by a reference to procedure_icons; data,
-- indexes and the immutability triggers (0011/0013/0017) are recreated exactly. runMigrations applies
-- migrations with foreign keys off and verifies foreign keys and integrity afterwards.
CREATE TABLE `procedure_icons` (
	`key` text PRIMARY KEY NOT NULL,
	CONSTRAINT "procedure_icons_key_format" CHECK("procedure_icons"."key" glob '[a-z]*' and length("procedure_icons"."key") between 1 and 40)
);
--> statement-breakpoint
INSERT INTO `procedure_icons` (`key`) VALUES ('checklist'), ('home'), ('kitchen'), ('cleaning'), ('laundry'), ('garden'), ('pet'), ('car'), ('travel'), ('tools'), ('health'), ('shopping'), ('document'), ('security'), ('star'), ('power'), ('water'), ('gas'), ('heating'), ('internet'), ('wifi'), ('lights'), ('trash'), ('recycling'), ('door'), ('window'), ('key'), ('plant'), ('bed'), ('bath'), ('onboarding'), ('offboarding'), ('team'), ('work'), ('calendar'), ('mail'), ('phone'), ('school'), ('computer'), ('server'), ('backup'), ('update'), ('launch'), ('medication'), ('baby'), ('food'), ('coffee'), ('fitness'), ('fire-safety'), ('warning'), ('alarm'), ('bike'), ('weather'), ('snow'), ('sun'), ('delivery'), ('money'), ('clock'), ('settings'), ('camera');
--> statement-breakpoint
CREATE TABLE `__new_procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text NOT NULL REFERENCES `procedure_icons`(`key`),
	`tags` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedures_id_uuid" CHECK(length("__new_procedures"."id") = 36),
	CONSTRAINT "procedures_title_present" CHECK(length(trim("__new_procedures"."title")) > 0 and length("__new_procedures"."title") <= 120),
	CONSTRAINT "procedures_description_bounded" CHECK(length("__new_procedures"."description") <= 4000),
	CONSTRAINT "procedures_tags_array" CHECK(json_valid("__new_procedures"."tags") and json_type("__new_procedures"."tags") = 'array' and json_array_length("__new_procedures"."tags") <= 10),
	CONSTRAINT "procedures_revision_positive" CHECK("__new_procedures"."revision" >= 1),
	CONSTRAINT "procedures_deletion_consistent" CHECK(("__new_procedures"."deleted_at" is null) = ("__new_procedures"."deleted_by_user_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_procedures` (`id`, `workspace_id`, `title`, `description`, `icon`, `tags`, `revision`, `created_by_user_id`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_user_id`) SELECT `id`, `workspace_id`, `title`, `description`, `icon`, `tags`, `revision`, `created_by_user_id`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_user_id` FROM `procedures`;
--> statement-breakpoint
DROP TABLE `procedures`;
--> statement-breakpoint
ALTER TABLE `__new_procedures` RENAME TO `procedures`;
--> statement-breakpoint
CREATE INDEX `procedures_workspace_idx` ON `procedures` (`workspace_id`,`deleted_at`);
--> statement-breakpoint
CREATE TABLE `__new_procedure_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text DEFAULT 'CHECK' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text REFERENCES `procedure_icons`(`key`),
	`required` integer NOT NULL,
	`critical` integer NOT NULL,
	`skip_reason_policy` text NOT NULL,
	`not_applicable_reason_policy` text NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`section_id`,`procedure_id`) REFERENCES `procedure_sections`(`id`,`procedure_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedure_steps_id_uuid" CHECK(length("__new_procedure_steps"."id") = 36),
	CONSTRAINT "procedure_steps_position_bounded" CHECK("__new_procedure_steps"."position" >= 0 and "__new_procedure_steps"."position" < 200),
	CONSTRAINT "procedure_steps_kind_valid" CHECK(kind in ('CHECK')),
	CONSTRAINT "procedure_steps_title_present" CHECK(length(trim("__new_procedure_steps"."title")) > 0 and length("__new_procedure_steps"."title") <= 200),
	CONSTRAINT "procedure_steps_description_bounded" CHECK(length("__new_procedure_steps"."description") <= 4000),
	CONSTRAINT "procedure_steps_skip_policy_valid" CHECK(skip_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "procedure_steps_na_policy_valid" CHECK(not_applicable_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED'))
);
--> statement-breakpoint
INSERT INTO `__new_procedure_steps` (`id`, `procedure_id`, `section_id`, `position`, `kind`, `title`, `description`, `icon`, `required`, `critical`, `skip_reason_policy`, `not_applicable_reason_policy`) SELECT `id`, `procedure_id`, `section_id`, `position`, `kind`, `title`, `description`, `icon`, `required`, `critical`, `skip_reason_policy`, `not_applicable_reason_policy` FROM `procedure_steps`;
--> statement-breakpoint
DROP TABLE `procedure_steps`;
--> statement-breakpoint
ALTER TABLE `__new_procedure_steps` RENAME TO `procedure_steps`;
--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_steps_position_unique` ON `procedure_steps` (`section_id`,`position`);
--> statement-breakpoint
CREATE INDEX `procedure_steps_procedure_idx` ON `procedure_steps` (`procedure_id`);
--> statement-breakpoint
CREATE TABLE `__new_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`run_section_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_step_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`icon` text REFERENCES `procedure_icons`(`key`),
	`required` integer NOT NULL,
	`critical` integer NOT NULL,
	`skip_reason_policy` text NOT NULL,
	`not_applicable_reason_policy` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL, `state_reason` text
	CONSTRAINT "run_steps_reason_only_when_skipped_or_na" CHECK("state_reason" is null or ("state" in ('SKIPPED', 'NOT_APPLICABLE') and length(trim("state_reason")) > 0 and length("state_reason") <= 500)), `state_changed_by_user_id` text REFERENCES users(id), `state_changed_by_display_name` text, `state_changed_at` integer
	CONSTRAINT "run_steps_state_change_complete" CHECK(("state_changed_by_user_id" is null) = ("state_changed_by_display_name" is null) and ("state_changed_by_user_id" is null) = ("state_changed_at" is null)), `state_changed_device_at` integer
	CONSTRAINT "run_steps_device_time_with_change" CHECK("state_changed_device_at" is null or "state_changed_at" is not null),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_section_id`,`run_id`) REFERENCES `run_sections`(`id`,`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_steps_id_uuid" CHECK(length("__new_run_steps"."id") = 36),
	CONSTRAINT "run_steps_kind_valid" CHECK(kind in ('CHECK')),
	CONSTRAINT "run_steps_skip_policy_valid" CHECK(skip_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "run_steps_na_policy_valid" CHECK(not_applicable_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "run_steps_state_valid" CHECK(state in ('PENDING', 'DONE', 'SKIPPED', 'NOT_APPLICABLE'))
);
--> statement-breakpoint
INSERT INTO `__new_run_steps` (`id`, `run_id`, `run_section_id`, `position`, `source_step_id`, `kind`, `title`, `description`, `icon`, `required`, `critical`, `skip_reason_policy`, `not_applicable_reason_policy`, `state`, `state_reason`, `state_changed_by_user_id`, `state_changed_by_display_name`, `state_changed_at`, `state_changed_device_at`) SELECT `id`, `run_id`, `run_section_id`, `position`, `source_step_id`, `kind`, `title`, `description`, `icon`, `required`, `critical`, `skip_reason_policy`, `not_applicable_reason_policy`, `state`, `state_reason`, `state_changed_by_user_id`, `state_changed_by_display_name`, `state_changed_at`, `state_changed_device_at` FROM `run_steps`;
--> statement-breakpoint
DROP TABLE `run_steps`;
--> statement-breakpoint
ALTER TABLE `__new_run_steps` RENAME TO `run_steps`;
--> statement-breakpoint
CREATE UNIQUE INDEX `run_steps_position_unique` ON `run_steps` (`run_section_id`,`position`);
--> statement-breakpoint
CREATE INDEX `run_steps_run_idx` ON `run_steps` (`run_id`);
--> statement-breakpoint
CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`procedure_id` text NOT NULL,
	`procedure_revision` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL REFERENCES `procedure_icons`(`key`),
	`tags` text NOT NULL,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_by_display_name` text NOT NULL,
	`started_at` integer NOT NULL, `ended_by_user_id` text REFERENCES users(id), `ended_by_display_name` text, `ended_at` integer
	CONSTRAINT "runs_end_consistent" CHECK(("ended_at" is null) = ("state" = 'ACTIVE') and ("ended_at" is null) = ("ended_by_user_id" is null) and ("ended_at" is null) = ("ended_by_display_name" is null)), `end_reason` text
	CONSTRAINT "runs_end_reason_only_when_aborted" CHECK("end_reason" is null or ("state" = 'ABORTED' and length(trim("end_reason")) > 0 and length("end_reason") <= 500)),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_id_uuid" CHECK(length("__new_runs"."id") = 36),
	CONSTRAINT "runs_state_valid" CHECK(state in ('ACTIVE', 'COMPLETED', 'ABORTED')),
	CONSTRAINT "runs_title_present" CHECK(length(trim("__new_runs"."title")) > 0 and length("__new_runs"."title") <= 120),
	CONSTRAINT "runs_tags_array" CHECK(json_valid("__new_runs"."tags") and json_type("__new_runs"."tags") = 'array'),
	CONSTRAINT "runs_revisions_positive" CHECK("__new_runs"."procedure_revision" >= 1 and "__new_runs"."revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_runs` (`id`, `workspace_id`, `procedure_id`, `procedure_revision`, `title`, `description`, `icon`, `tags`, `state`, `revision`, `started_by_user_id`, `started_by_display_name`, `started_at`, `ended_by_user_id`, `ended_by_display_name`, `ended_at`, `end_reason`) SELECT `id`, `workspace_id`, `procedure_id`, `procedure_revision`, `title`, `description`, `icon`, `tags`, `state`, `revision`, `started_by_user_id`, `started_by_display_name`, `started_at`, `ended_by_user_id`, `ended_by_display_name`, `ended_at`, `end_reason` FROM `runs`;
--> statement-breakpoint
DROP TABLE `runs`;
--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;
--> statement-breakpoint
CREATE INDEX `runs_procedure_idx` ON `runs` (`procedure_id`);
--> statement-breakpoint
CREATE INDEX `runs_workspace_state_idx` ON `runs` (`workspace_id`,`state`,`started_at`);
--> statement-breakpoint
CREATE TRIGGER `run_steps_no_delete`
BEFORE DELETE ON `run_steps`
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
CREATE TRIGGER `run_steps_state_only_while_active`
BEFORE UPDATE OF `state`, `state_reason`, `state_changed_by_user_id`, `state_changed_by_display_name`, `state_changed_at`, `state_changed_device_at` ON `run_steps`
WHEN (SELECT `state` FROM `runs` WHERE `id` = NEW.`run_id`) <> 'ACTIVE'
BEGIN
	SELECT RAISE(ABORT, 'run is not active');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_finished_immutable`
BEFORE UPDATE ON `runs`
WHEN OLD.`state` <> 'ACTIVE'
BEGIN
	SELECT RAISE(ABORT, 'run is finished');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_no_delete`
BEFORE DELETE ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'runs are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_snapshot_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `procedure_id`, `procedure_revision`, `title`, `description`, `icon`, `tags`,
	`started_by_user_id`, `started_by_display_name`, `started_at` ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'run snapshot is immutable');
END;
