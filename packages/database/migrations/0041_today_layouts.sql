-- 19.2: a person's Today layout (cards, order, size, options, density); personal, never part of a Workspace.
CREATE TABLE `user_today_layouts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_today_layouts_layout_bounded" CHECK(json_valid("user_today_layouts"."layout") and length("user_today_layouts"."layout") <= 4096),
	CONSTRAINT "user_today_layouts_version_positive" CHECK("user_today_layouts"."version" >= 1)
);
