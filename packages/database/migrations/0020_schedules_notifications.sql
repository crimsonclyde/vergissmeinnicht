-- Scheduled Procedures, reminders, notification channels, pins and the Recent limit (steps.md 13.4–13.13).
-- Hand-edited: drizzle-kit rebuilds instance_settings for the new column; a plain ADD with a column
-- CHECK keeps the data and is equivalent.
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`reminder_time` text NOT NULL,
	`email_reminders` integer NOT NULL,
	`telegram_reminders` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_preferences_reminder_time_format" CHECK("notification_preferences"."reminder_time" glob '[0-2][0-9]:[0-5][0-9]')
);
--> statement-breakpoint
CREATE TABLE `notification_providers` (
	`provider` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`sealed_secret` text,
	`public_label` text,
	`poll_offset` integer,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_providers_valid" CHECK(provider in ('EMAIL', 'TELEGRAM')),
	CONSTRAINT "notification_providers_sealed_format" CHECK("notification_providers"."sealed_secret" is null or "notification_providers"."sealed_secret" like 'v1.%'),
	CONSTRAINT "notification_providers_label_bounded" CHECK("notification_providers"."public_label" is null or length("notification_providers"."public_label") <= 64)
);
--> statement-breakpoint
CREATE TABLE `procedure_pins` (
	`user_id` text NOT NULL,
	`procedure_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`pinned_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `procedure_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `procedure_pins_workspace_idx` ON `procedure_pins` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `reminder_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	`error_code` text,
	FOREIGN KEY (`reminder_id`) REFERENCES `scheduled_reminders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reminder_deliveries_id_uuid" CHECK(length("reminder_deliveries"."id") = 36),
	CONSTRAINT "reminder_deliveries_channel_valid" CHECK(channel in ('EMAIL', 'TELEGRAM')),
	CONSTRAINT "reminder_deliveries_status_valid" CHECK(status in ('SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED')),
	CONSTRAINT "reminder_deliveries_attempts_bounded" CHECK("reminder_deliveries"."attempts" between 0 and 10),
	CONSTRAINT "reminder_deliveries_sent_consistent" CHECK(("reminder_deliveries"."status" = 'SENT') = ("reminder_deliveries"."sent_at" is not null)),
	CONSTRAINT "reminder_deliveries_error_code_bounded" CHECK("reminder_deliveries"."error_code" is null or length("reminder_deliveries"."error_code") <= 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_deliveries_once_per_channel` ON `reminder_deliveries` (`reminder_id`,`channel`);--> statement-breakpoint
CREATE INDEX `reminder_deliveries_retry_idx` ON `reminder_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `scheduled_procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`procedure_id` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`time_zone` text NOT NULL,
	`reminder_time` text NOT NULL,
	`reminders` text NOT NULL,
	`state` text DEFAULT 'SCHEDULED' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`run_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`closed_by_display_name` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_procedures_id_uuid" CHECK(length("scheduled_procedures"."id") = 36),
	CONSTRAINT "scheduled_procedures_date_format" CHECK("scheduled_procedures"."date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "scheduled_procedures_time_format" CHECK("scheduled_procedures"."time" is null or "scheduled_procedures"."time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "scheduled_procedures_reminder_time_format" CHECK("scheduled_procedures"."reminder_time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "scheduled_procedures_time_zone_bounded" CHECK(length("scheduled_procedures"."time_zone") between 1 and 64),
	CONSTRAINT "scheduled_procedures_reminders_array" CHECK(json_valid("scheduled_procedures"."reminders") and json_type("scheduled_procedures"."reminders") = 'array' and json_array_length("scheduled_procedures"."reminders") <= 5),
	CONSTRAINT "scheduled_procedures_state_valid" CHECK(state in ('SCHEDULED', 'STARTED', 'CANCELLED')),
	CONSTRAINT "scheduled_procedures_revision_positive" CHECK("scheduled_procedures"."revision" >= 1),
	CONSTRAINT "scheduled_procedures_run_when_started" CHECK(("scheduled_procedures"."state" = 'STARTED') = ("scheduled_procedures"."run_id" is not null)),
	CONSTRAINT "scheduled_procedures_closed_consistent" CHECK(("scheduled_procedures"."state" = 'SCHEDULED') = ("scheduled_procedures"."closed_at" is null) and ("scheduled_procedures"."closed_at" is null) = ("scheduled_procedures"."closed_by_user_id" is null) and ("scheduled_procedures"."closed_at" is null) = ("scheduled_procedures"."closed_by_display_name" is null))
);
--> statement-breakpoint
CREATE INDEX `scheduled_procedures_workspace_idx` ON `scheduled_procedures` (`workspace_id`,`state`,`date`);--> statement-breakpoint
CREATE INDEX `scheduled_procedures_procedure_idx` ON `scheduled_procedures` (`procedure_id`);--> statement-breakpoint
CREATE TABLE `scheduled_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`reminder_key` text NOT NULL,
	`remind_at` integer NOT NULL,
	`recipient_user_id` text NOT NULL,
	`processed_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `scheduled_procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_reminders_id_uuid" CHECK(length("scheduled_reminders"."id") = 36),
	CONSTRAINT "scheduled_reminders_key_format" CHECK("scheduled_reminders"."reminder_key" glob '[A-Z]*:[0-9]*' and length("scheduled_reminders"."reminder_key") <= 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_reminders_instant_unique` ON `scheduled_reminders` (`schedule_id`,`reminder_key`,`remind_at`);--> statement-breakpoint
CREATE INDEX `scheduled_reminders_due_idx` ON `scheduled_reminders` (`processed_at`,`cancelled_at`,`remind_at`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`chat_label` text NOT NULL,
	`connected_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "telegram_links_chat_id_format" CHECK("telegram_links"."chat_id" glob '[0-9]*' and length("telegram_links"."chat_id") between 1 and 20),
	CONSTRAINT "telegram_links_label_bounded" CHECK(length("telegram_links"."chat_label") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE `telegram_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`chat_id` text,
	`chat_label` text,
	`completed_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "telegram_pairings_id_uuid" CHECK(length("telegram_pairings"."id") = 36),
	CONSTRAINT "telegram_pairings_token_hash_format" CHECK(length("telegram_pairings"."token_hash") = 64),
	CONSTRAINT "telegram_pairings_expiry_after_creation" CHECK("telegram_pairings"."expires_at" > "telegram_pairings"."created_at"),
	CONSTRAINT "telegram_pairings_claim_consistent" CHECK(("telegram_pairings"."claimed_at" is null) = ("telegram_pairings"."chat_id" is null) and ("telegram_pairings"."chat_id" is null) = ("telegram_pairings"."chat_label" is null)),
	CONSTRAINT "telegram_pairings_completed_after_claim" CHECK("telegram_pairings"."completed_at" is null or "telegram_pairings"."claimed_at" is not null),
	CONSTRAINT "telegram_pairings_single_outcome" CHECK("telegram_pairings"."completed_at" is null or "telegram_pairings"."cancelled_at" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_pairings_token_hash_unique` ON `telegram_pairings` (`token_hash`);--> statement-breakpoint
CREATE INDEX `telegram_pairings_user_idx` ON `telegram_pairings` (`user_id`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `recent_procedures_limit` integer DEFAULT 5 NOT NULL
	CONSTRAINT "instance_settings_recent_limit_bounded" CHECK("recent_procedures_limit" between 0 and 20);
--> statement-breakpoint
-- Scheduled items are never deleted; who scheduled what for which Procedure never changes.
CREATE TRIGGER `scheduled_procedures_no_delete`
BEFORE DELETE ON `scheduled_procedures`
BEGIN
	SELECT RAISE(ABORT, 'scheduled procedures are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `scheduled_procedures_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `procedure_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `scheduled_procedures`
BEGIN
	SELECT RAISE(ABORT, 'scheduled procedure identity is immutable');
END;
--> statement-breakpoint
-- Started or cancelled is final: the item then only documents what happened.
CREATE TRIGGER `scheduled_procedures_closed_final`
BEFORE UPDATE ON `scheduled_procedures`
WHEN OLD.`state` <> 'SCHEDULED'
BEGIN
	SELECT RAISE(ABORT, 'scheduled procedure is closed');
END;
