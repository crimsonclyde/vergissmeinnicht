CREATE TABLE `gazette_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`edition_date` text NOT NULL,
	`state` text NOT NULL,
	`content` text NOT NULL,
	`revision` integer NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gazette_edition_valid" CHECK(state in ('DRAFT', 'PUBLISHED') and length("gazette_editions"."edition_date") = 10 and json_valid("gazette_editions"."content") and length("gazette_editions"."content") <= 600000 and json_extract("gazette_editions"."content", '$.version') = 1 and json_extract("gazette_editions"."content", '$.date') = "gazette_editions"."edition_date" and "gazette_editions"."revision" >= 1 and (("gazette_editions"."state" = 'PUBLISHED') = ("gazette_editions"."published_at" is not null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gazette_edition_date_state` ON `gazette_editions` (`workspace_id`,`edition_date`,`state`);--> statement-breakpoint
CREATE INDEX `gazette_edition_workspace_state` ON `gazette_editions` (`workspace_id`,`state`,`edition_date`);--> statement-breakpoint
CREATE TABLE `gazette_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`edition_id` text NOT NULL,
	`edition_date` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gazette_operations_at` ON `gazette_operations` (`at`);--> statement-breakpoint
CREATE TABLE `gazette_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gazette_settings_valid" CHECK(json_valid("gazette_settings"."settings") and length("gazette_settings"."settings") <= 100000 and json_extract("gazette_settings"."settings", '$.version') = 1 and json_extract("gazette_settings"."settings", '$.retentionDays') between 1 and 31 and "gazette_settings"."revision" >= 1)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_tools` (
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL', 'GAMIFICATION', 'BRING', 'RECIPES', 'GAZETTE'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;