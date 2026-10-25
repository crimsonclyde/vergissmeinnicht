ALTER TABLE user_preferences ADD COLUMN navigation_order text CONSTRAINT user_preferences_navigation_bound CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 9 and length(navigation_order) <= 256));
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_insert BEFORE INSERT ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_update BEFORE UPDATE ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
