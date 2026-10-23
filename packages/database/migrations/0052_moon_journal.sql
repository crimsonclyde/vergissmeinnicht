CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`workspace_id` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_kind" CHECK("journal_entries"."kind" = 'note' and "journal_entries"."version" = 1),
	CONSTRAINT "journal_bounds" CHECK(length("journal_entries"."title") between 1 and 160 and length("journal_entries"."body") <= 50000 and "journal_entries"."revision" >= 1 and "journal_entries"."archived" in (0, 1)),
	CONSTRAINT "journal_date" CHECK(length("journal_entries"."date") = 10 and date("journal_entries"."date", '+0 days') is not null and date("journal_entries"."date", '+0 days') = "journal_entries"."date")
);
--> statement-breakpoint
CREATE INDEX `journal_workspace_date` ON `journal_entries` (`workspace_id`,`archived`,`date`,`id`);--> statement-breakpoint
CREATE TABLE `private_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "private_journal_kind" CHECK("private_journal_entries"."kind" = 'note' and "private_journal_entries"."version" = 1),
	CONSTRAINT "private_journal_bounds" CHECK(length("private_journal_entries"."title") between 1 and 160 and length("private_journal_entries"."body") <= 50000 and "private_journal_entries"."revision" >= 1 and "private_journal_entries"."archived" in (0, 1)),
	CONSTRAINT "private_journal_date" CHECK(length("private_journal_entries"."date") = 10 and date("private_journal_entries"."date", '+0 days') is not null and date("private_journal_entries"."date", '+0 days') = "private_journal_entries"."date"),
	CONSTRAINT "private_journal_owner" CHECK("private_journal_entries"."owner_id" = "private_journal_entries"."created_by_user_id" and "private_journal_entries"."owner_id" = "private_journal_entries"."updated_by_user_id")
);
--> statement-breakpoint
CREATE INDEX `private_journal_owner_date` ON `private_journal_entries` (`owner_id`,`archived`,`date`,`id`);--> statement-breakpoint
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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER journal_identity_immutable BEFORE UPDATE OF id, workspace_id, kind, version, created_by_user_id, created_by, created_at ON journal_entries BEGIN SELECT RAISE(ABORT, 'journal identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_identity_immutable BEFORE UPDATE OF id, owner_id, kind, version, created_by_user_id, created_by, created_at ON private_journal_entries BEGIN SELECT RAISE(ABORT, 'journal identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_active_insert BEFORE INSERT ON private_journal_entries WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id AND status = 'ACTIVE') BEGIN SELECT RAISE(ABORT, 'journal owner must be active'); END;
