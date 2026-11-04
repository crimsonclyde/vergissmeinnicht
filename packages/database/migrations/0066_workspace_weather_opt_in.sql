CREATE TABLE `user_weather_workspace_locations` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `user_weather_workspace_locations` (`user_id`, `workspace_id`, `created_at`)
SELECT `user_weather_settings`.`user_id`, `memberships`.`workspace_id`, cast(unixepoch('subsecond') * 1000 as integer)
FROM `user_weather_settings`
INNER JOIN `memberships` ON `memberships`.`user_id` = `user_weather_settings`.`user_id`
WHERE `user_weather_settings`.`use_workspace_location` = 1;
--> statement-breakpoint
ALTER TABLE `user_weather_settings` DROP COLUMN `use_workspace_location`;
