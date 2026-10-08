-- 19.4: personal weather settings (never part of a Workspace) and the server's weather settings (server admins).
CREATE TABLE `server_weather_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`allowed` text NOT NULL,
	`met_contact` text,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "server_weather_settings_single_row" CHECK("server_weather_settings"."id" = 1),
	CONSTRAINT "server_weather_settings_bounded" CHECK(length("server_weather_settings"."allowed") <= 100 and ("server_weather_settings"."met_contact" is null or length("server_weather_settings"."met_contact") <= 254))
);
--> statement-breakpoint
CREATE TABLE `user_weather_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`place_name` text,
	`latitude` real,
	`longitude` real,
	`time_zone` text,
	`elevation` integer,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`fallback` integer NOT NULL,
	`unit` text NOT NULL,
	`show_tomorrow` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_weather_settings_location_complete" CHECK(("user_weather_settings"."place_name" is null) = ("user_weather_settings"."latitude" is null) and ("user_weather_settings"."place_name" is null) = ("user_weather_settings"."longitude" is null) and ("user_weather_settings"."place_name" is null) = ("user_weather_settings"."time_zone" is null) and ("user_weather_settings"."place_name" is not null or "user_weather_settings"."elevation" is null)),
	CONSTRAINT "user_weather_settings_location_valid" CHECK("user_weather_settings"."place_name" is null or (length("user_weather_settings"."place_name") between 1 and 480 and "user_weather_settings"."latitude" between -90 and 90 and "user_weather_settings"."longitude" between -180 and 180 and length("user_weather_settings"."time_zone") <= 64)),
	CONSTRAINT "user_weather_settings_elevation_valid" CHECK("user_weather_settings"."elevation" is null or "user_weather_settings"."elevation" between -500 and 9000),
	CONSTRAINT "user_weather_settings_provider_valid" CHECK("user_weather_settings"."provider" in ('AUTO', 'OPEN_METEO', 'MET_NORWAY', 'OPENWEATHER', 'METEOMATICS')),
	CONSTRAINT "user_weather_settings_model_valid" CHECK(length("user_weather_settings"."model") between 1 and 64),
	CONSTRAINT "user_weather_settings_unit_valid" CHECK("user_weather_settings"."unit" in ('C', 'F'))
);
