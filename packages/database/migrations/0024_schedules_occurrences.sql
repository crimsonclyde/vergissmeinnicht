-- Schedules and Occurrences (steps.md 14.1). Hand-written around generated DDL: existing one-time
-- scheduled Procedures (13.4) become one-time PROCEDURE Schedules with one Occurrence each, keeping
-- their ids (audit history with subject "schedule" keeps pointing at them); a started item's Run is
-- linked; reminders and delivery records are kept and re-pointed to the Occurrence, so nothing already
-- sent or processed is sent again (D14). Runs with foreign keys off (runMigrations), then checked.
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`procedure_id` text,
	`title` text,
	`description` text DEFAULT '' NOT NULL,
	`recurrence_kind` text NOT NULL,
	`recurrence_unit` text,
	`recurrence_interval` integer,
	`recurrence_weekdays` text,
	`recurrence_last_day` integer DEFAULT false NOT NULL,
	`anchor_date` text NOT NULL,
	`time` text,
	`time_zone` text NOT NULL,
	`reminders` text NOT NULL,
	`assignee_user_id` text,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`paused_at` integer,
	`ended_at` integer,
	`ended_by_user_id` text,
	`ended_by_display_name` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ended_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_id_uuid" CHECK(length("schedules"."id") = 36),
	CONSTRAINT "schedules_kind_valid" CHECK(kind in ('REMINDER', 'PROCEDURE')),
	CONSTRAINT "schedules_kind_consistent" CHECK(("schedules"."kind" = 'PROCEDURE') = ("schedules"."procedure_id" is not null) and ("schedules"."kind" = 'REMINDER') = ("schedules"."title" is not null)),
	CONSTRAINT "schedules_title_bounded" CHECK("schedules"."title" is null or length("schedules"."title") between 1 and 120),
	CONSTRAINT "schedules_description_bounded" CHECK(length("schedules"."description") <= 4000),
	CONSTRAINT "schedules_recurrence_kind_valid" CHECK(recurrence_kind in ('ONCE', 'FIXED', 'AFTER_COMPLETION')),
	CONSTRAINT "schedules_recurrence_consistent" CHECK(("schedules"."recurrence_kind" = 'ONCE') = ("schedules"."recurrence_unit" is null) and ("schedules"."recurrence_unit" is null) = ("schedules"."recurrence_interval" is null) and ("schedules"."recurrence_unit" is null or "schedules"."recurrence_unit" in ('DAY', 'WEEK', 'MONTH', 'YEAR')) and ("schedules"."recurrence_interval" is null or "schedules"."recurrence_interval" between 1 and 99)),
	CONSTRAINT "schedules_weekdays_valid" CHECK("schedules"."recurrence_weekdays" is null or ("schedules"."recurrence_kind" = 'FIXED' and "schedules"."recurrence_unit" = 'WEEK' and json_valid("schedules"."recurrence_weekdays") and json_type("schedules"."recurrence_weekdays") = 'array' and json_array_length("schedules"."recurrence_weekdays") between 1 and 7)),
	CONSTRAINT "schedules_last_day_valid" CHECK("schedules"."recurrence_last_day" = 0 or ("schedules"."recurrence_kind" = 'FIXED' and "schedules"."recurrence_unit" = 'MONTH')),
	CONSTRAINT "schedules_anchor_format" CHECK("schedules"."anchor_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "schedules_time_format" CHECK("schedules"."time" is null or "schedules"."time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "schedules_time_zone_bounded" CHECK(length("schedules"."time_zone") between 1 and 64),
	CONSTRAINT "schedules_reminders_array" CHECK(json_valid("schedules"."reminders") and json_type("schedules"."reminders") = 'array' and json_array_length("schedules"."reminders") <= 5),
	CONSTRAINT "schedules_state_valid" CHECK(state in ('ACTIVE', 'PAUSED', 'ENDED')),
	CONSTRAINT "schedules_paused_consistent" CHECK(("schedules"."state" = 'PAUSED') = ("schedules"."paused_at" is not null)),
	CONSTRAINT "schedules_ended_consistent" CHECK(("schedules"."state" = 'ENDED') = ("schedules"."ended_at" is not null) and ("schedules"."ended_at" is null) = ("schedules"."ended_by_user_id" is null) and ("schedules"."ended_at" is null) = ("schedules"."ended_by_display_name" is null)),
	CONSTRAINT "schedules_revision_positive" CHECK("schedules"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `schedules_workspace_idx` ON `schedules` (`workspace_id`,`state`);
--> statement-breakpoint
CREATE INDEX `schedules_procedure_idx` ON `schedules` (`procedure_id`);
--> statement-breakpoint
CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`due_date` text NOT NULL,
	`time` text,
	`state` text DEFAULT 'OPEN' NOT NULL,
	`assignee_user_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`closed_by_display_name` text,
	`skip_reason` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "occurrences_id_uuid" CHECK(length("occurrences"."id") = 36),
	CONSTRAINT "occurrences_due_format" CHECK("occurrences"."due_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "occurrences_time_format" CHECK("occurrences"."time" is null or "occurrences"."time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "occurrences_state_valid" CHECK(state in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
	CONSTRAINT "occurrences_closed_consistent" CHECK(("occurrences"."state" in ('COMPLETED', 'SKIPPED', 'CANCELLED')) = ("occurrences"."closed_at" is not null) and ("occurrences"."closed_at" is null) = ("occurrences"."closed_by_user_id" is null) and ("occurrences"."closed_at" is null) = ("occurrences"."closed_by_display_name" is null)),
	CONSTRAINT "occurrences_skip_reason_valid" CHECK("occurrences"."skip_reason" is null or ("occurrences"."state" = 'SKIPPED' and length("occurrences"."skip_reason") between 1 and 500)),
	CONSTRAINT "occurrences_revision_positive" CHECK("occurrences"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrences_due_unique` ON `occurrences` (`schedule_id`,`due_date`) WHERE "occurrences"."state" <> 'CANCELLED';
--> statement-breakpoint
CREATE INDEX `occurrences_workspace_idx` ON `occurrences` (`workspace_id`,`state`,`due_date`);
--> statement-breakpoint
CREATE INDEX `occurrences_schedule_idx` ON `occurrences` (`schedule_id`,`due_date`);
--> statement-breakpoint
CREATE TABLE `occurrence_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`how` text NOT NULL,
	`linked_at` integer NOT NULL,
	`linked_by_user_id` text NOT NULL,
	`linked_by_display_name` text NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	FOREIGN KEY (`occurrence_id`) REFERENCES `occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "occurrence_runs_id_uuid" CHECK(length("occurrence_runs"."id") = 36),
	CONSTRAINT "occurrence_runs_how_valid" CHECK("occurrence_runs"."how" in ('STARTED', 'LINKED')),
	CONSTRAINT "occurrence_runs_end_consistent" CHECK(("occurrence_runs"."ended_at" is null) = ("occurrence_runs"."end_reason" is null) and ("occurrence_runs"."end_reason" is null or "occurrence_runs"."end_reason" in ('ABORTED', 'UNLINKED')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_runs_current_run` ON `occurrence_runs` (`run_id`) WHERE "occurrence_runs"."ended_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_runs_current_occurrence` ON `occurrence_runs` (`occurrence_id`) WHERE "occurrence_runs"."ended_at" is null;
--> statement-breakpoint
CREATE INDEX `occurrence_runs_occurrence_idx` ON `occurrence_runs` (`occurrence_id`);
--> statement-breakpoint
CREATE TABLE `notification_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	`error_code` text,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_summaries_id_uuid" CHECK(length("notification_summaries"."id") = 36),
	CONSTRAINT "notification_summaries_channel_valid" CHECK(channel in ('EMAIL', 'TELEGRAM')),
	CONSTRAINT "notification_summaries_status_valid" CHECK(status in ('SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED')),
	CONSTRAINT "notification_summaries_attempts_bounded" CHECK("notification_summaries"."attempts" between 0 and 10),
	CONSTRAINT "notification_summaries_sent_consistent" CHECK(("notification_summaries"."status" = 'SENT') = ("notification_summaries"."sent_at" is not null)),
	CONSTRAINT "notification_summaries_error_code_bounded" CHECK("notification_summaries"."error_code" is null or length("notification_summaries"."error_code") <= 40)
);
--> statement-breakpoint
CREATE INDEX `notification_summaries_retry_idx` ON `notification_summaries` (`status`,`next_attempt_at`);
--> statement-breakpoint
INSERT INTO `schedules` (`id`, `workspace_id`, `kind`, `procedure_id`, `title`, `description`, `recurrence_kind`, `recurrence_unit`, `recurrence_interval`, `recurrence_weekdays`, `recurrence_last_day`, `anchor_date`, `time`, `time_zone`, `reminders`, `assignee_user_id`, `state`, `paused_at`, `ended_at`, `ended_by_user_id`, `ended_by_display_name`, `revision`, `created_by_user_id`, `created_by_display_name`, `created_at`, `updated_at`)
SELECT `id`, `workspace_id`, 'PROCEDURE', `procedure_id`, NULL, '', 'ONCE', NULL, NULL, NULL, 0, `date`, `time`, `time_zone`, `reminders`, NULL,
  CASE `state` WHEN 'CANCELLED' THEN 'ENDED' ELSE 'ACTIVE' END, NULL,
  CASE `state` WHEN 'CANCELLED' THEN `closed_at` END,
  CASE `state` WHEN 'CANCELLED' THEN `closed_by_user_id` END,
  CASE `state` WHEN 'CANCELLED' THEN `closed_by_display_name` END,
  `revision`, `created_by_user_id`, `created_by_display_name`, `created_at`, `updated_at`
FROM `scheduled_procedures`;
--> statement-breakpoint
-- The Occurrence's state follows the item and, when started, its Run: active → IN_PROGRESS,
-- completed → COMPLETED (by whoever completed the Run), aborted → OPEN again (the Run stays linked in history).
INSERT INTO `occurrences` (`id`, `schedule_id`, `workspace_id`, `due_date`, `time`, `state`, `assignee_user_id`, `closed_at`, `closed_by_user_id`, `closed_by_display_name`, `skip_reason`, `revision`, `created_at`, `updated_at`)
SELECT sp.`id`, sp.`id`, sp.`workspace_id`, sp.`date`, sp.`time`,
  CASE
    WHEN sp.`state` = 'SCHEDULED' THEN 'OPEN'
    WHEN sp.`state` = 'CANCELLED' THEN 'CANCELLED'
    WHEN r.`state` = 'ACTIVE' THEN 'IN_PROGRESS'
    WHEN r.`state` = 'COMPLETED' THEN 'COMPLETED'
    ELSE 'OPEN'
  END,
  NULL,
  CASE WHEN sp.`state` = 'CANCELLED' THEN sp.`closed_at` WHEN r.`state` = 'COMPLETED' THEN r.`ended_at` END,
  CASE WHEN sp.`state` = 'CANCELLED' THEN sp.`closed_by_user_id` WHEN r.`state` = 'COMPLETED' THEN r.`ended_by_user_id` END,
  CASE WHEN sp.`state` = 'CANCELLED' THEN sp.`closed_by_display_name` WHEN r.`state` = 'COMPLETED' THEN r.`ended_by_display_name` END,
  NULL, sp.`revision`, sp.`created_at`, sp.`updated_at`
FROM `scheduled_procedures` sp LEFT JOIN `runs` r ON r.`id` = sp.`run_id`;
--> statement-breakpoint
INSERT INTO `occurrence_runs` (`id`, `occurrence_id`, `run_id`, `workspace_id`, `how`, `linked_at`, `linked_by_user_id`, `linked_by_display_name`, `ended_at`, `end_reason`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  sp.`id`, r.`id`, sp.`workspace_id`, 'STARTED', r.`started_at`, r.`started_by_user_id`, r.`started_by_display_name`,
  CASE WHEN r.`state` = 'ABORTED' THEN r.`ended_at` END,
  CASE WHEN r.`state` = 'ABORTED' THEN 'ABORTED' END
FROM `scheduled_procedures` sp JOIN `runs` r ON r.`id` = sp.`run_id`
WHERE sp.`state` = 'STARTED';
--> statement-breakpoint
CREATE TABLE `__new_scheduled_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`reminder_key` text NOT NULL,
	`remind_at` integer NOT NULL,
	`recipient_user_id` text NOT NULL,
	`processed_at` integer,
	`next_attempt_at` integer,
	`cancelled_at` integer,
	`superseded_at` integer,
	FOREIGN KEY (`occurrence_id`) REFERENCES `occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_reminders_id_uuid" CHECK(length("__new_scheduled_reminders"."id") = 36),
	CONSTRAINT "scheduled_reminders_key_format" CHECK("__new_scheduled_reminders"."reminder_key" glob '[A-Z]*:[0-9]*' and length("__new_scheduled_reminders"."reminder_key") <= 16),
	CONSTRAINT "scheduled_reminders_superseded_processed" CHECK("__new_scheduled_reminders"."superseded_at" is null or "__new_scheduled_reminders"."processed_at" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_reminders` (`id`, `occurrence_id`, `reminder_key`, `remind_at`, `recipient_user_id`, `processed_at`, `next_attempt_at`, `cancelled_at`, `superseded_at`)
SELECT `id`, `schedule_id`, `reminder_key`, `remind_at`, `recipient_user_id`, `processed_at`, `next_attempt_at`, `cancelled_at`, NULL FROM `scheduled_reminders`;
--> statement-breakpoint
DROP TABLE `scheduled_reminders`;
--> statement-breakpoint
ALTER TABLE `__new_scheduled_reminders` RENAME TO `scheduled_reminders`;
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_reminders_instant_unique` ON `scheduled_reminders` (`occurrence_id`,`recipient_user_id`,`reminder_key`,`remind_at`);
--> statement-breakpoint
CREATE INDEX `scheduled_reminders_due_idx` ON `scheduled_reminders` (`processed_at`,`cancelled_at`,`remind_at`);
--> statement-breakpoint
CREATE TABLE `__new_reminder_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	`error_code` text,
	`summary_id` text,
	FOREIGN KEY (`reminder_id`) REFERENCES `scheduled_reminders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`summary_id`) REFERENCES `notification_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reminder_deliveries_id_uuid" CHECK(length("__new_reminder_deliveries"."id") = 36),
	CONSTRAINT "reminder_deliveries_channel_valid" CHECK(channel in ('EMAIL', 'TELEGRAM')),
	CONSTRAINT "reminder_deliveries_status_valid" CHECK(status in ('SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED', 'GROUPED')),
	CONSTRAINT "reminder_deliveries_attempts_bounded" CHECK("__new_reminder_deliveries"."attempts" between 0 and 10),
	CONSTRAINT "reminder_deliveries_sent_consistent" CHECK(("__new_reminder_deliveries"."status" = 'SENT') = ("__new_reminder_deliveries"."sent_at" is not null)),
	CONSTRAINT "reminder_deliveries_error_code_bounded" CHECK("__new_reminder_deliveries"."error_code" is null or length("__new_reminder_deliveries"."error_code") <= 40),
	CONSTRAINT "reminder_deliveries_grouped_summary" CHECK("__new_reminder_deliveries"."status" <> 'GROUPED' or "__new_reminder_deliveries"."summary_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_reminder_deliveries` (`id`, `reminder_id`, `channel`, `status`, `attempts`, `next_attempt_at`, `updated_at`, `sent_at`, `error_code`, `summary_id`)
SELECT `id`, `reminder_id`, `channel`, `status`, `attempts`, `next_attempt_at`, `updated_at`, `sent_at`, `error_code`, NULL FROM `reminder_deliveries`;
--> statement-breakpoint
DROP TABLE `reminder_deliveries`;
--> statement-breakpoint
ALTER TABLE `__new_reminder_deliveries` RENAME TO `reminder_deliveries`;
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_deliveries_once_per_channel` ON `reminder_deliveries` (`reminder_id`,`channel`);
--> statement-breakpoint
CREATE INDEX `reminder_deliveries_retry_idx` ON `reminder_deliveries` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `reminder_deliveries_summary_idx` ON `reminder_deliveries` (`summary_id`);
--> statement-breakpoint
DROP TRIGGER `scheduled_procedures_no_delete`;
--> statement-breakpoint
DROP TRIGGER `scheduled_procedures_identity_immutable`;
--> statement-breakpoint
DROP TRIGGER `scheduled_procedures_closed_final`;
--> statement-breakpoint
DROP TABLE `scheduled_procedures`;
--> statement-breakpoint
CREATE TRIGGER `schedules_no_delete`
BEFORE DELETE ON `schedules`
BEGIN
	SELECT RAISE(ABORT, 'schedules are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `schedules_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `kind`, `procedure_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `schedules`
BEGIN
	SELECT RAISE(ABORT, 'schedule identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `schedules_ended_final`
BEFORE UPDATE ON `schedules`
WHEN OLD.`state` = 'ENDED'
BEGIN
	SELECT RAISE(ABORT, 'schedule has ended');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrences_no_delete`
BEFORE DELETE ON `occurrences`
BEGIN
	SELECT RAISE(ABORT, 'occurrences are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrences_identity_immutable`
BEFORE UPDATE OF `id`, `schedule_id`, `workspace_id`, `created_at` ON `occurrences`
BEGIN
	SELECT RAISE(ABORT, 'occurrence identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrences_cancelled_final`
BEFORE UPDATE ON `occurrences`
WHEN OLD.`state` = 'CANCELLED'
BEGIN
	SELECT RAISE(ABORT, 'occurrence is cancelled');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrence_runs_no_delete`
BEFORE DELETE ON `occurrence_runs`
BEGIN
	SELECT RAISE(ABORT, 'occurrence links are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrence_runs_identity_immutable`
BEFORE UPDATE OF `id`, `occurrence_id`, `run_id`, `workspace_id`, `how`, `linked_at`, `linked_by_user_id`, `linked_by_display_name` ON `occurrence_runs`
BEGIN
	SELECT RAISE(ABORT, 'occurrence link identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `occurrence_runs_ended_final`
BEFORE UPDATE ON `occurrence_runs`
WHEN OLD.`ended_at` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'occurrence link has ended');
END;
