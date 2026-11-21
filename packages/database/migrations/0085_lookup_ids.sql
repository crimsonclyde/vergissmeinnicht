CREATE TABLE `theme_ids` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`navigable` integer DEFAULT false NOT NULL,
	CONSTRAINT "tool_ids_navigable_bool" CHECK("tool_ids"."navigable" in (0, 1))
);
--> statement-breakpoint
-- 45.3: the ids that preference and tool rows reference. A new theme or tool adds one row in its own migration.
INSERT INTO `theme_ids`(`id`) VALUES ('system'), ('light'), ('dark'), ('memento-mori'), ('tokyo-nights'), ('witch-forest'), ('space-guide'), ('places-de'), ('places-it'), ('places-uk'), ('places-scotland');--> statement-breakpoint
INSERT INTO `tool_ids`(`id`,`navigable`) VALUES ('PROCEDURES',1), ('REMINDERS',1), ('LISTS',1), ('CALENDAR',1), ('DOCUMENTS',1), ('CONTACTS',1), ('MAINTENANCE',1), ('EQUIPMENT',1), ('MOON',0), ('JOURNAL',1), ('GAMIFICATION',0), ('BRING',1), ('RECIPES',1), ('GAZETTE',0), ('MAP',1);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`private_gamification` integer DEFAULT true NOT NULL,
	`navigation_order` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme`) REFERENCES `theme_ids`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_private_gamification" CHECK(private_gamification in (0, 1)),
	CONSTRAINT "user_preferences_navigation_bound" CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 64 and length(navigation_order) <= 1024)),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at") SELECT "user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_user_workspace_preferences` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`theme` text,
	`is_default` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`guide` text,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme`) REFERENCES `theme_ids`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_workspace_preferences_is_default_bool" CHECK("__new_user_workspace_preferences"."is_default" in (0, 1)),
	CONSTRAINT "user_workspace_preferences_not_empty" CHECK("__new_user_workspace_preferences"."theme" is not null or "__new_user_workspace_preferences"."is_default" = 1 or guide is not null),
	CONSTRAINT "user_workspace_preferences_guide_valid" CHECK(guide is null or (json_valid(guide) and length(guide) <= 256 and json_type(guide) = 'object' and json_extract(guide, '$.layout') in ('guide', 'classic') and json_extract(guide, '$.cardStyle') in ('glass', 'starfield', 'forest', 'water', 'hearth') and json_type(guide, '$.cardOpacity') = 'integer' and json_extract(guide, '$.cardOpacity') between 0 and 100 and json_type(guide, '$.images') in ('true', 'false') and json_type(guide, '$.layout') is not null and json_type(guide, '$.cardStyle') is not null and json_type(guide, '$.cardOpacity') is not null and json_type(guide, '$.images') is not null))
);
--> statement-breakpoint
INSERT INTO `__new_user_workspace_preferences`("user_id", "workspace_id", "theme", "is_default", "updated_at", "guide") SELECT "user_id", "workspace_id", "theme", "is_default", "updated_at", "guide" FROM `user_workspace_preferences`;--> statement-breakpoint
DROP TABLE `user_workspace_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_workspace_preferences` RENAME TO `user_workspace_preferences`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_workspace_preferences_one_default` ON `user_workspace_preferences` (`user_id`) WHERE "user_workspace_preferences"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `__new_workspace_tools` (
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool`) REFERENCES `tool_ids`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
-- A table rebuild drops its triggers: the navigation order now checks against tool_ids; the Guide triggers are those of 0083.
CREATE TRIGGER preferences_navigation_insert BEFORE INSERT ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN (SELECT `id` FROM `tool_ids` WHERE `navigable` = 1)) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_update BEFORE UPDATE ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN (SELECT `id` FROM `tool_ids` WHERE `navigable` = 1)) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
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
