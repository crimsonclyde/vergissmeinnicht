CREATE TABLE `list_client_changes` (
	`user_id` text NOT NULL,
	`client_change_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`list_id` text NOT NULL,
	`outcome` text NOT NULL,
	`by_display_name` text,
	`at` integer,
	`applied_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `client_change_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "list_client_changes_id_uuid" CHECK(length("list_client_changes"."client_change_id") = 36 and length("list_client_changes"."list_id") = 36),
	CONSTRAINT "list_client_changes_outcome_valid" CHECK(outcome in ('APPLIED', 'OVERRIDDEN', 'ITEM_REMOVED', 'LIST_DELETED', 'NOT_FOUND', 'LIMIT_REACHED'))
);
--> statement-breakpoint
CREATE INDEX `list_client_changes_age_idx` ON `list_client_changes` (`applied_at`);--> statement-breakpoint
-- 17.5: when and by whom each part was last set ("the later change wins"). SQLite adds a NOT NULL
-- column only with a default; the default is replaced right away from what each row already says.
ALTER TABLE `list_items` ADD `deleted_by_display_name` text;--> statement-breakpoint
ALTER TABLE `list_items` ADD `content_changed_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `list_items` ADD `content_changed_by_display_name` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `list_items` ADD `check_changed_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `list_items` ADD `check_changed_by_display_name` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `lists` ADD `title_changed_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `lists` ADD `title_changed_by_display_name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `list_items` SET `content_changed_at` = `created_at`, `content_changed_by_display_name` = `created_by_display_name`,
  `check_changed_at` = coalesce(`checked_at`, `created_at`), `check_changed_by_display_name` = coalesce(`checked_by_display_name`, `created_by_display_name`);--> statement-breakpoint
UPDATE `lists` SET `title_changed_at` = `created_at`, `title_changed_by_display_name` = `created_by_display_name`;
