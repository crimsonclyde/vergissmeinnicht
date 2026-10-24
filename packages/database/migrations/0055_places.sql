CREATE TABLE `user_place_backgrounds` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`jpeg` blob NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_place_backgrounds_jpeg_valid" CHECK(typeof("user_place_backgrounds"."jpeg") = 'blob' and length("user_place_backgrounds"."jpeg") between 4 and 700000 and substr("user_place_backgrounds"."jpeg", 1, 3) = x'ffd8ff'),
	CONSTRAINT "user_place_backgrounds_size_valid" CHECK("user_place_backgrounds"."width" between 1 and 2400 and "user_place_backgrounds"."height" between 1 and 2400)
);
--> statement-breakpoint
CREATE TABLE `user_place_preferences` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`settings` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_place_preferences_settings_valid" CHECK(json_valid("user_place_preferences"."settings") and json_type("user_place_preferences"."settings") = 'object' and length("user_place_preferences"."settings") <= 2000)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_theme_valid" CHECK(theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "updated_at") SELECT "user_id", "theme", "critical_confirm", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_user_workspace_preferences` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`theme` text,
	`is_default` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_workspace_preferences_theme_valid" CHECK(theme is null or theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_workspace_preferences_is_default_bool" CHECK("__new_user_workspace_preferences"."is_default" in (0, 1)),
	CONSTRAINT "user_workspace_preferences_not_empty" CHECK("__new_user_workspace_preferences"."theme" is not null or "__new_user_workspace_preferences"."is_default" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_user_workspace_preferences`("user_id", "workspace_id", "theme", "is_default", "updated_at") SELECT "user_id", "workspace_id", "theme", "is_default", "updated_at" FROM `user_workspace_preferences`;--> statement-breakpoint
DROP TABLE `user_workspace_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_workspace_preferences` RENAME TO `user_workspace_preferences`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_workspace_preferences_one_default` ON `user_workspace_preferences` (`user_id`) WHERE "user_workspace_preferences"."is_default" = 1;