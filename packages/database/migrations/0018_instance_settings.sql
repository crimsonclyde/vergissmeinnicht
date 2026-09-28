CREATE TABLE `instance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`footer_hidden` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "instance_settings_single_row" CHECK("instance_settings"."id" = 1)
);
