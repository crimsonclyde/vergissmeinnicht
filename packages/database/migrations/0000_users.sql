CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "users_id_uuid" CHECK(length("users"."id") = 36),
	CONSTRAINT "users_email_normalized" CHECK("users"."email" = lower(trim("users"."email")) and length("users"."email") <= 254),
	CONSTRAINT "users_display_name_present" CHECK(length(trim("users"."display_name")) > 0),
	CONSTRAINT "users_status_valid" CHECK(status in ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);