CREATE TABLE `map_approaches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_approaches_valid" CHECK(json_valid("map_approaches"."details") and length("map_approaches"."details") <= 18000 and length(json_extract("map_approaches"."details", '$.name')) between 1 and 480)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_approaches_tenant` ON `map_approaches` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `map_operations` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`place_id` text NOT NULL,
	`hash` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`place_id`) REFERENCES `map_places`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `map_operations_time` ON `map_operations` (`at`);--> statement-breakpoint
CREATE TABLE `map_personal` (
	`workspace_id` text NOT NULL,
	`place_id` text NOT NULL,
	`user_id` text NOT NULL,
	`favorite` integer NOT NULL,
	`want` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `place_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`place_id`) REFERENCES `map_places`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_personal_valid" CHECK("map_personal"."favorite" in (0, 1) and "map_personal"."want" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `map_place_points` (
	`workspace_id` text NOT NULL,
	`place_id` text NOT NULL,
	`point_id` text NOT NULL,
	`role` text NOT NULL,
	`preferred` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `place_id`, `point_id`, `role`),
	FOREIGN KEY (`workspace_id`,`place_id`) REFERENCES `map_places`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`point_id`) REFERENCES `map_points`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_place_points_valid" CHECK(role in ('destination', 'parking', 'trailhead') and "map_place_points"."preferred" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_preferred_point` ON `map_place_points` (`workspace_id`,`place_id`) WHERE "map_place_points"."preferred" = 1;--> statement-breakpoint
CREATE INDEX `map_point_places` ON `map_place_points` (`workspace_id`,`point_id`);--> statement-breakpoint
CREATE TABLE `map_place_tags` (
	`workspace_id` text NOT NULL,
	`place_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `place_id`, `tag_id`),
	FOREIGN KEY (`workspace_id`,`place_id`) REFERENCES `map_places`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`tag_id`) REFERENCES `map_tags`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `map_tag_places` ON `map_place_tags` (`workspace_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `map_places` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`details` text NOT NULL,
	`identity` text,
	`cover_attachment_id` text,
	`approach_id` text,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`approach_id`) REFERENCES `map_approaches`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_places_valid" CHECK(category in ('food', 'shopping', 'historic', 'urbex', 'trailhead', 'other') and length("map_places"."name") between 1 and 480 and json_valid("map_places"."details") and length("map_places"."details") <= 64000 and "map_places"."revision" >= 1 and "map_places"."archived" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_places_tenant` ON `map_places` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_places_identity` ON `map_places` (`workspace_id`,`identity`);--> statement-breakpoint
CREATE INDEX `map_places_browse` ON `map_places` (`workspace_id`,`archived`,`category`,`name`);--> statement-breakpoint
CREATE TABLE `map_points` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`label` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`precision` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_points_valid" CHECK(precision in ('exact', 'approximate') and "map_points"."latitude" between -90 and 90 and "map_points"."longitude" between -180 and 180 and length("map_points"."label") between 1 and 480 and length("map_points"."provenance") <= 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_points_tenant` ON `map_points` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `map_points_bounds` ON `map_points` (`workspace_id`,`latitude`,`longitude`);--> statement-breakpoint
CREATE TABLE `map_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_tags_valid" CHECK(length("map_tags"."name") between 1 and 240 and length("map_tags"."name_key") between 1 and 480)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_tags_tenant` ON `map_tags` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_tags_name` ON `map_tags` (`workspace_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `map_visit_photos` (
	`workspace_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `visit_id`, `attachment_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`visit_id`,`user_id`) REFERENCES `map_visits`(`workspace_id`,`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `map_visit_photo_attachment` ON `map_visit_photos` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `map_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`place_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text,
	`note` text NOT NULL,
	`rating` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`place_id`) REFERENCES `map_places`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "map_visits_valid" CHECK(("map_visits"."date" is null or length("map_visits"."date") = 10) and length("map_visits"."note") <= 16000 and ("map_visits"."rating" is null or "map_visits"."rating" between 1 and 5))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_visits_tenant_owner` ON `map_visits` (`workspace_id`,`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `map_visits_owner` ON `map_visits` (`workspace_id`,`user_id`,`place_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`private_gamification` integer DEFAULT true NOT NULL,
	`navigation_order` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_theme_valid" CHECK(theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'space-guide', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_preferences_private_gamification" CHECK(private_gamification in (0, 1)),
	CONSTRAINT "user_preferences_navigation_bound" CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 12 and length(navigation_order) <= 256)),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at") SELECT "user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_workspace_tools` (
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL', 'GAMIFICATION', 'BRING', 'RECIPES', 'GAZETTE', 'MAP'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;
--> statement-breakpoint
CREATE TRIGGER map_cover_scope_insert BEFORE INSERT ON map_places
WHEN NEW.cover_attachment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attachments WHERE id = NEW.cover_attachment_id AND workspace_id = NEW.workspace_id AND policy_key = 'map_cover' AND deleting = 0
) BEGIN SELECT RAISE(ABORT, 'map_cover_scope'); END;
--> statement-breakpoint
CREATE TRIGGER map_cover_scope_update BEFORE UPDATE OF cover_attachment_id, workspace_id ON map_places
WHEN NEW.cover_attachment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attachments WHERE id = NEW.cover_attachment_id AND workspace_id = NEW.workspace_id AND policy_key = 'map_cover' AND deleting = 0
) BEGIN SELECT RAISE(ABORT, 'map_cover_scope'); END;
--> statement-breakpoint
CREATE TRIGGER map_visit_photo_scope BEFORE INSERT ON map_visit_photos
WHEN NOT EXISTS (
  SELECT 1 FROM attachments WHERE id = NEW.attachment_id AND workspace_id = NEW.workspace_id AND uploaded_by_user_id = NEW.user_id AND policy_key = 'map_visit' AND deleting = 0
) BEGIN SELECT RAISE(ABORT, 'map_visit_photo_scope'); END;

--> statement-breakpoint
CREATE TRIGGER preferences_navigation_insert BEFORE INSERT ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING','RECIPES','MAP')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_update BEFORE UPDATE ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING','RECIPES','MAP')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
