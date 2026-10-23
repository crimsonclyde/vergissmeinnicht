ALTER TABLE `user_weather_settings` ADD `use_workspace_location` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `location` text;
--> statement-breakpoint
CREATE TRIGGER workspace_location_insert_guard BEFORE INSERT ON workspaces
WHEN NEW.location IS NOT NULL
BEGIN
  SELECT CASE WHEN json_valid(NEW.location) = 0 THEN RAISE(ABORT, 'invalid_workspace_location') END;
  SELECT CASE WHEN length(NEW.location) > 2048 OR json_type(NEW.location) != 'object'
    OR typeof(json_extract(NEW.location, '$.name')) != 'text' OR length(json_extract(NEW.location, '$.name')) NOT BETWEEN 1 AND 480
    OR typeof(json_extract(NEW.location, '$.latitude')) NOT IN ('integer', 'real') OR json_extract(NEW.location, '$.latitude') NOT BETWEEN -90 AND 90
    OR typeof(json_extract(NEW.location, '$.longitude')) NOT IN ('integer', 'real') OR json_extract(NEW.location, '$.longitude') NOT BETWEEN -180 AND 180
    OR typeof(json_extract(NEW.location, '$.timeZone')) != 'text' OR length(json_extract(NEW.location, '$.timeZone')) NOT BETWEEN 1 AND 64
    OR (json_extract(NEW.location, '$.elevation') IS NOT NULL AND (typeof(json_extract(NEW.location, '$.elevation')) != 'integer' OR json_extract(NEW.location, '$.elevation') NOT BETWEEN -500 AND 9000))
    THEN RAISE(ABORT, 'invalid_workspace_location') END;
END;

--> statement-breakpoint
CREATE TRIGGER workspace_location_update_guard BEFORE UPDATE OF location ON workspaces
WHEN NEW.location IS NOT NULL
BEGIN
  SELECT CASE WHEN json_valid(NEW.location) = 0 THEN RAISE(ABORT, 'invalid_workspace_location') END;
  SELECT CASE WHEN length(NEW.location) > 2048 OR json_type(NEW.location) != 'object'
    OR typeof(json_extract(NEW.location, '$.name')) != 'text' OR length(json_extract(NEW.location, '$.name')) NOT BETWEEN 1 AND 480
    OR typeof(json_extract(NEW.location, '$.latitude')) NOT IN ('integer', 'real') OR json_extract(NEW.location, '$.latitude') NOT BETWEEN -90 AND 90
    OR typeof(json_extract(NEW.location, '$.longitude')) NOT IN ('integer', 'real') OR json_extract(NEW.location, '$.longitude') NOT BETWEEN -180 AND 180
    OR typeof(json_extract(NEW.location, '$.timeZone')) != 'text' OR length(json_extract(NEW.location, '$.timeZone')) NOT BETWEEN 1 AND 64
    OR (json_extract(NEW.location, '$.elevation') IS NOT NULL AND (typeof(json_extract(NEW.location, '$.elevation')) != 'integer' OR json_extract(NEW.location, '$.elevation') NOT BETWEEN -500 AND 9000))
    THEN RAISE(ABORT, 'invalid_workspace_location') END;
END;
