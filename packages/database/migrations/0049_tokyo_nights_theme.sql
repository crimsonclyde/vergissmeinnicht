PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_theme_valid" CHECK(theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights')),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "updated_at") SELECT "user_id", "theme", "critical_confirm", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;