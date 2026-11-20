DROP TRIGGER IF EXISTS user_workspace_preferences_guide_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_workspace_preferences_guide_update;
--> statement-breakpoint
CREATE TRIGGER user_workspace_preferences_guide_insert BEFORE INSERT ON user_workspace_preferences WHEN NEW.guide IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.guide) THEN RAISE(ABORT,'invalid Guide preferences') END;
 SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.guide)) NOT IN (4, 5) OR (SELECT count(*) FROM json_each(NEW.guide)) <> (SELECT count(DISTINCT key) FROM json_each(NEW.guide)) OR EXISTS (SELECT 1 FROM json_each(NEW.guide) WHERE key NOT IN ('layout','cardStyle','cardOpacity','images','scopeFilter')) OR (json_type(NEW.guide, '$.scopeFilter') IS NOT NULL AND json_type(NEW.guide, '$.scopeFilter') NOT IN ('true','false')) THEN RAISE(ABORT,'invalid Guide preferences') END;
END;
--> statement-breakpoint
CREATE TRIGGER user_workspace_preferences_guide_update BEFORE UPDATE ON user_workspace_preferences WHEN NEW.guide IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.guide) THEN RAISE(ABORT,'invalid Guide preferences') END;
 SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.guide)) NOT IN (4, 5) OR (SELECT count(*) FROM json_each(NEW.guide)) <> (SELECT count(DISTINCT key) FROM json_each(NEW.guide)) OR EXISTS (SELECT 1 FROM json_each(NEW.guide) WHERE key NOT IN ('layout','cardStyle','cardOpacity','images','scopeFilter')) OR (json_type(NEW.guide, '$.scopeFilter') IS NOT NULL AND json_type(NEW.guide, '$.scopeFilter') NOT IN ('true','false')) THEN RAISE(ABORT,'invalid Guide preferences') END;
END;
