CREATE TABLE `gazette_weather_forecasts` (
	`workspace_id` text NOT NULL,
	`location_key` text NOT NULL,
	`source_id` text NOT NULL,
	`issued_on` text NOT NULL,
	`target_date` text NOT NULL,
	`lead` integer NOT NULL,
	`high` real,
	`low` real,
	`precipitation_mm` real,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `location_key`, `source_id`, `issued_on`, `target_date`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "gazette_weather_forecasts_valid" CHECK(length("gazette_weather_forecasts"."location_key") <= 32 and length("gazette_weather_forecasts"."source_id") between 1 and 40 and length("gazette_weather_forecasts"."issued_on") = 10 and length("gazette_weather_forecasts"."target_date") = 10 and "gazette_weather_forecasts"."lead" between 0 and 15 and ("gazette_weather_forecasts"."high" is null or "gazette_weather_forecasts"."high" between -90 and 60) and ("gazette_weather_forecasts"."low" is null or "gazette_weather_forecasts"."low" between -90 and 60) and ("gazette_weather_forecasts"."precipitation_mm" is null or "gazette_weather_forecasts"."precipitation_mm" between 0 and 2000))
);
--> statement-breakpoint
CREATE INDEX `gazette_weather_forecasts_target` ON `gazette_weather_forecasts` (`workspace_id`,`location_key`,`target_date`);--> statement-breakpoint
CREATE TABLE `gazette_weather_observations` (
	`workspace_id` text NOT NULL,
	`location_key` text NOT NULL,
	`date` text NOT NULL,
	`high` real,
	`low` real,
	`precipitation_mm` real,
	`station` text NOT NULL,
	`distance_m` integer NOT NULL,
	`elevation_m` integer,
	`source` text NOT NULL,
	`hours` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `location_key`, `date`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "gazette_weather_observations_valid" CHECK(length("gazette_weather_observations"."location_key") <= 32 and length("gazette_weather_observations"."date") = 10 and length("gazette_weather_observations"."station") between 1 and 320 and length("gazette_weather_observations"."source") between 1 and 80 and "gazette_weather_observations"."distance_m" between 0 and 100000 and "gazette_weather_observations"."hours" between 1 and 25 and ("gazette_weather_observations"."high" is null or "gazette_weather_observations"."high" between -90 and 60) and ("gazette_weather_observations"."low" is null or "gazette_weather_observations"."low" between -90 and 60) and ("gazette_weather_observations"."precipitation_mm" is null or "gazette_weather_observations"."precipitation_mm" between 0 and 2000))
);
--> statement-breakpoint
ALTER TABLE `gazette_watch_prices` ADD COLUMN `shipping` real CONSTRAINT "gazette_watch_price_shipping" CHECK (`shipping` IS NULL OR `shipping` >= 0);--> statement-breakpoint
ALTER TABLE `gazette_watch_prices` ADD COLUMN `vat_included` integer CONSTRAINT "gazette_watch_price_vat" CHECK (`vat_included` IS NULL OR `vat_included` IN (0, 1));--> statement-breakpoint
UPDATE `gazette_settings` SET `settings` = json_replace(`settings`, '$.sections[' || (
  SELECT `key` FROM json_each(`gazette_settings`.`settings`, '$.sections') WHERE json_extract(`value`, '$.type') = 'weather' AND json_extract(`value`, '$.brief') = 'Triora (Imperia, Liguria) and Göggenhofen (Bavaria): seven days, up to three sources compared, disagreements as ranges, official warnings (ARPAL for Liguria). Name every source; never invent values.' LIMIT 1
) || '].brief', 'VMN fills this section on the server from the Workspace location, comparing several sources and official warnings. Write only a short summary from get_gazette_weather; never add places, values or warnings yourself.')
WHERE EXISTS (SELECT 1 FROM json_each(`gazette_settings`.`settings`, '$.sections') WHERE json_extract(`value`, '$.type') = 'weather' AND json_extract(`value`, '$.brief') = 'Triora (Imperia, Liguria) and Göggenhofen (Bavaria): seven days, up to three sources compared, disagreements as ranges, official warnings (ARPAL for Liguria). Name every source; never invent values.');
