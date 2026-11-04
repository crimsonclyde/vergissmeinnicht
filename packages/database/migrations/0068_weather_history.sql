CREATE TABLE `weather_history` (
	`user_id` text NOT NULL,
	`location_key` text NOT NULL,
	`local_date` text NOT NULL,
	`min` real NOT NULL,
	`max` real NOT NULL,
	`samples` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `location_key`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "weather_history_date_length" CHECK(length("weather_history"."local_date") = 10),
	CONSTRAINT "weather_history_min_max" CHECK("weather_history"."min" <= "weather_history"."max"),
	CONSTRAINT "weather_history_samples_positive" CHECK("weather_history"."samples" >= 1)
);
