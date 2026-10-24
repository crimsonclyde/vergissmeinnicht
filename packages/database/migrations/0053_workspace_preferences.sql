CREATE TABLE `user_workspace_preferences` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`theme` text,
	`is_default` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_workspace_preferences_theme_valid" CHECK(theme is null or theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest')),
	CONSTRAINT "user_workspace_preferences_is_default_bool" CHECK("user_workspace_preferences"."is_default" in (0, 1)),
	CONSTRAINT "user_workspace_preferences_not_empty" CHECK("user_workspace_preferences"."theme" is not null or "user_workspace_preferences"."is_default" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_workspace_preferences_one_default` ON `user_workspace_preferences` (`user_id`) WHERE "user_workspace_preferences"."is_default" = 1;