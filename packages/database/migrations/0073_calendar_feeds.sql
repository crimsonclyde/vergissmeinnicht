CREATE TABLE `calendar_feeds` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_feeds_token_hash_format" CHECK(length("calendar_feeds"."token_hash") = 64),
	CONSTRAINT "calendar_feeds_scope_valid" CHECK(scope in ('MINE', 'ALL'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_hash_unique` ON `calendar_feeds` (`token_hash`);
