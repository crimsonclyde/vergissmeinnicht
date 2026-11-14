CREATE TABLE `gazette_watch_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`variant` text NOT NULL,
	`condition` text NOT NULL,
	`market` text NOT NULL,
	`shop` text NOT NULL,
	`url` text,
	`currency` text NOT NULL,
	`target` real,
	`typical` real,
	`notes` text NOT NULL,
	`active` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gazette_watch_item_valid" CHECK(condition in ('any', 'new', 'refurbished', 'used') and length("gazette_watch_items"."name") between 1 and 480 and length("gazette_watch_items"."variant") <= 480 and length("gazette_watch_items"."market") <= 32 and length("gazette_watch_items"."shop") <= 320 and ("gazette_watch_items"."url" is null or (length("gazette_watch_items"."url") <= 2048 and "gazette_watch_items"."url" like 'https://%')) and length("gazette_watch_items"."currency") = 3 and length("gazette_watch_items"."notes") <= 4000 and ("gazette_watch_items"."target" is null or "gazette_watch_items"."target" >= 0) and ("gazette_watch_items"."typical" is null or "gazette_watch_items"."typical" >= 0) and "gazette_watch_items"."active" in (0, 1) and "gazette_watch_items"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `gazette_watch_items_workspace` ON `gazette_watch_items` (`workspace_id`,`active`);--> statement-breakpoint
CREATE TABLE `gazette_watch_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`item_id` text NOT NULL,
	`price` real NOT NULL,
	`verified` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `gazette_watch_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gazette_watch_price_valid" CHECK("gazette_watch_prices"."price" >= 0 and "gazette_watch_prices"."verified" in (0, 1) and length("gazette_watch_prices"."source") <= 320 and ("gazette_watch_prices"."url" is null or (length("gazette_watch_prices"."url") <= 2048 and "gazette_watch_prices"."url" like 'https://%')))
);
--> statement-breakpoint
CREATE INDEX `gazette_watch_prices_item` ON `gazette_watch_prices` (`item_id`,`checked_at`);