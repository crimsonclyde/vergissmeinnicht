PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`guide` text DEFAULT '{"layout":"guide","cardStyle":"glass","cardOpacity":50,"images":true}' NOT NULL,
	`private_gamification` integer DEFAULT true NOT NULL,
	`navigation_order` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_theme_valid" CHECK(theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'space-guide', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_preferences_guide_valid" CHECK(json_valid(guide) and length(guide) <= 256 and json_type(guide) = 'object' and json_extract(guide, '$.layout') in ('guide', 'classic') and json_extract(guide, '$.cardStyle') in ('glass', 'starfield') and json_type(guide, '$.cardOpacity') = 'integer' and json_extract(guide, '$.cardOpacity') between 0 and 100 and json_type(guide, '$.images') in ('true', 'false') and json_type(guide, '$.layout') is not null and json_type(guide, '$.cardStyle') is not null and json_type(guide, '$.cardOpacity') is not null and json_type(guide, '$.images') is not null),
	CONSTRAINT "user_preferences_private_gamification" CHECK(private_gamification in (0, 1)),
	CONSTRAINT "user_preferences_navigation_bound" CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 10 and length(navigation_order) <= 256)),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "guide", "private_gamification", "navigation_order", "updated_at") SELECT "user_id", "theme", "critical_confirm", '{"layout":"guide","cardStyle":"glass","cardOpacity":50,"images":true}', "private_gamification", "navigation_order", "updated_at" FROM `user_preferences`;
--> statement-breakpoint
DROP TABLE `user_preferences`;
--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `__new_user_workspace_preferences` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`theme` text,
	`is_default` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_workspace_preferences_theme_valid" CHECK(theme is null or theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'space-guide', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_workspace_preferences_is_default_bool" CHECK("__new_user_workspace_preferences"."is_default" in (0, 1)),
	CONSTRAINT "user_workspace_preferences_not_empty" CHECK("__new_user_workspace_preferences"."theme" is not null or "__new_user_workspace_preferences"."is_default" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_user_workspace_preferences`("user_id", "workspace_id", "theme", "is_default", "updated_at") SELECT "user_id", "workspace_id", "theme", "is_default", "updated_at" FROM `user_workspace_preferences`;
--> statement-breakpoint
DROP TABLE `user_workspace_preferences`;
--> statement-breakpoint
ALTER TABLE `__new_user_workspace_preferences` RENAME TO `user_workspace_preferences`;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_workspace_preferences_one_default` ON `user_workspace_preferences` (`user_id`) WHERE "user_workspace_preferences"."is_default" = 1;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_insert BEFORE INSERT ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_update BEFORE UPDATE ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;

--> statement-breakpoint
CREATE TRIGGER preferences_guide_insert BEFORE INSERT ON user_preferences BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.guide) THEN RAISE(ABORT,'invalid Guide preferences') END;
 SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.guide)) <> 4 OR (SELECT count(DISTINCT key) FROM json_each(NEW.guide)) <> 4 OR EXISTS (SELECT 1 FROM json_each(NEW.guide) WHERE key NOT IN ('layout','cardStyle','cardOpacity','images')) THEN RAISE(ABORT,'invalid Guide preferences') END;
END;

--> statement-breakpoint
CREATE TRIGGER preferences_guide_update BEFORE UPDATE ON user_preferences BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.guide) THEN RAISE(ABORT,'invalid Guide preferences') END;
 SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.guide)) <> 4 OR (SELECT count(DISTINCT key) FROM json_each(NEW.guide)) <> 4 OR EXISTS (SELECT 1 FROM json_each(NEW.guide) WHERE key NOT IN ('layout','cardStyle','cardOpacity','images')) THEN RAISE(ABORT,'invalid Guide preferences') END;
END;
