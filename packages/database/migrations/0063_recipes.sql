CREATE TABLE `recipe_attachment_references` (
	`recipe_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `attachment_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_shopping_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`item_ids` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content` text NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_content" CHECK(json_valid("recipes"."content") and length("recipes"."content") <= 400000 and json_extract("recipes"."content", '$.version') = 1 and "recipes"."revision" >= 1 and "recipes"."archived" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_id_workspace` ON `recipes` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `recipes_workspace_updated` ON `recipes` (`workspace_id`,`archived`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "user_preferences_navigation_bound" CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 11 and length(navigation_order) <= 256)),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "guide", "private_gamification", "navigation_order", "updated_at") SELECT "user_id", "theme", "critical_confirm", "guide", "private_gamification", "navigation_order", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_tools` (
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL', 'GAMIFICATION', 'BRING', 'RECIPES'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_insert BEFORE INSERT ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING','RECIPES')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_navigation_update BEFORE UPDATE ON user_preferences WHEN NEW.navigation_order IS NOT NULL BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.navigation_order) THEN RAISE(ABORT,'invalid navigation order') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.navigation_order) WHERE type <> 'text' OR value NOT IN ('PROCEDURES','LISTS','REMINDERS','CALENDAR','JOURNAL','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','BRING','RECIPES')) OR (SELECT count(*) FROM json_each(NEW.navigation_order)) <> (SELECT count(DISTINCT value) FROM json_each(NEW.navigation_order)) THEN RAISE(ABORT,'invalid navigation order') END;
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

--> statement-breakpoint
CREATE TRIGGER recipe_identity_immutable BEFORE UPDATE OF id,workspace_id,created_at,created_by_user_id,created_by ON recipes BEGIN SELECT RAISE(ABORT,'immutable recipe identity'); END;
--> statement-breakpoint
CREATE TRIGGER recipe_attachment_scope BEFORE INSERT ON recipe_attachment_references BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND workspace_id=NEW.workspace_id) OR NOT EXISTS(SELECT 1 FROM attachments WHERE id=NEW.attachment_id AND workspace_id=NEW.workspace_id AND policy_key='recipes' AND deleting=0) THEN RAISE(ABORT,'invalid recipe image scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER recipe_attachment_immutable BEFORE UPDATE ON recipe_attachment_references BEGIN SELECT RAISE(ABORT,'immutable recipe image reference'); END;
