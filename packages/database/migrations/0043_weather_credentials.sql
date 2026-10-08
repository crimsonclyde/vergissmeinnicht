-- 19.4b: sealed weather provider credentials, server-wide (server admins) or personal (their owner only).
CREATE TABLE `weather_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`sealed` text NOT NULL,
	`available_to_users` integer NOT NULL,
	`daily_budget` integer NOT NULL,
	`usage_day` text,
	`used_today` integer NOT NULL,
	`last_test_at` integer,
	`last_test_ok` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "weather_credentials_scope_owner" CHECK(("weather_credentials"."scope" = 'SERVER') = ("weather_credentials"."user_id" is null) and ("weather_credentials"."scope" = 'SERVER' or "weather_credentials"."available_to_users" = 0)),
	CONSTRAINT "weather_credentials_provider_valid" CHECK("weather_credentials"."provider" in ('OPENWEATHER', 'METEOMATICS')),
	CONSTRAINT "weather_credentials_sealed_format" CHECK("weather_credentials"."sealed" like 'v1.%' and length("weather_credentials"."sealed") <= 2048),
	CONSTRAINT "weather_credentials_budget_valid" CHECK("weather_credentials"."daily_budget" between 1 and 1000 and "weather_credentials"."used_today" >= 0),
	CONSTRAINT "weather_credentials_test_consistent" CHECK(("weather_credentials"."last_test_at" is null) = ("weather_credentials"."last_test_ok" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weather_credentials_server_unique` ON `weather_credentials` (`provider`) WHERE "weather_credentials"."scope" = 'SERVER';--> statement-breakpoint
CREATE UNIQUE INDEX `weather_credentials_user_unique` ON `weather_credentials` (`user_id`,`provider`) WHERE "weather_credentials"."scope" = 'USER';