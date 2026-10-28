CREATE TABLE `bring_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`from_place` text NOT NULL,
	`to_place` text NOT NULL,
	`due_date` text,
	`assignee_user_id` text,
	`notes` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	`completed_by_user_id` text,
	`completed_by` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`cancelled_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bring_text" CHECK(length(trim("bring_items"."title")) between 1 and 120 and length("bring_items"."from_place") <= 80 and length("bring_items"."to_place") <= 80 and length("bring_items"."notes") <= 2000),
	CONSTRAINT "bring_status" CHECK("bring_items"."status" in ('OPEN','COMPLETED','CANCELLED')),
	CONSTRAINT "bring_revision" CHECK("bring_items"."revision" >= 1 and "bring_items"."deleted" in (0,1)),
	CONSTRAINT "bring_date" CHECK("bring_items"."due_date" is null or ("bring_items"."due_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("bring_items"."due_date", '+0 days') is not null and date("bring_items"."due_date", '+0 days') = "bring_items"."due_date")),
	CONSTRAINT "bring_completion" CHECK(("bring_items"."status" = 'COMPLETED') = ("bring_items"."completed_at" is not null) and ("bring_items"."completed_at" is null) = ("bring_items"."completed_by_user_id" is null) and ("bring_items"."completed_at" is null) = ("bring_items"."completed_by" is null)),
	CONSTRAINT "bring_cancellation" CHECK(("bring_items"."status" = 'CANCELLED') = ("bring_items"."cancelled_at" is not null) and ("bring_items"."cancelled_at" is null) = ("bring_items"."cancelled_by_user_id" is null) and ("bring_items"."cancelled_at" is null) = ("bring_items"."cancelled_by" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bring_id_workspace` ON `bring_items` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `bring_workspace_status` ON `bring_items` (`workspace_id`,`deleted`,`status`,`updated_at`);--> statement-breakpoint
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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL', 'GAMIFICATION', 'BRING'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER bring_assignment_insert BEFORE INSERT ON bring_items WHEN NEW.assignee_user_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=NEW.workspace_id AND m.user_id=NEW.assignee_user_id AND u.status='ACTIVE') THEN RAISE(ABORT,'invalid Bring assignee') END;
END;
--> statement-breakpoint
CREATE TRIGGER bring_assignment_update BEFORE UPDATE OF assignee_user_id, workspace_id ON bring_items WHEN NEW.assignee_user_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=NEW.workspace_id AND m.user_id=NEW.assignee_user_id AND u.status='ACTIVE') THEN RAISE(ABORT,'invalid Bring assignee') END;
END;
--> statement-breakpoint
CREATE TRIGGER bring_unassign_member AFTER DELETE ON memberships BEGIN
 UPDATE bring_items SET assignee_user_id=NULL, revision=revision+1 WHERE workspace_id=OLD.workspace_id AND assignee_user_id=OLD.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER bring_unassign_disabled AFTER UPDATE OF status ON users WHEN NEW.status <> 'ACTIVE' BEGIN
 UPDATE bring_items SET assignee_user_id=NULL, revision=revision+1 WHERE assignee_user_id=NEW.id;
END;

--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`critical_confirm` text NOT NULL,
	`private_gamification` integer DEFAULT true NOT NULL,
	`navigation_order` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_preferences_theme_valid" CHECK(theme in ('system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland')),
	CONSTRAINT "user_preferences_private_gamification" CHECK(private_gamification in (0, 1)),
	CONSTRAINT "user_preferences_navigation_bound" CHECK(navigation_order is null or (json_valid(navigation_order) and json_type(navigation_order) = 'array' and json_array_length(navigation_order) <= 10 and length(navigation_order) <= 256)),
	CONSTRAINT "user_preferences_critical_confirm_valid" CHECK(critical_confirm in ('hold', 'tap-confirm'))
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at") SELECT "user_id", "theme", "critical_confirm", "private_gamification", "navigation_order", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
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
CREATE TRIGGER bring_identity_immutable BEFORE UPDATE OF id,workspace_id,created_by_user_id,created_by,created_at ON bring_items
WHEN NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT,'immutable Bring identity'); END;
