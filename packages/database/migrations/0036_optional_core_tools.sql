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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Upgrade only: preserve the core tools that every existing Workspace already had.
-- New Workspaces have no flag rows and therefore start with every tool off.
INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id)
SELECT id, 'PROCEDURES', 1, updated_at, created_by_user_id FROM workspaces;
--> statement-breakpoint
INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id)
SELECT id, 'REMINDERS', 1, updated_at, created_by_user_id FROM workspaces;
--> statement-breakpoint
INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id)
SELECT id, 'LISTS', 1, updated_at, created_by_user_id FROM workspaces;
--> statement-breakpoint
INSERT INTO workspace_tools (workspace_id, tool, enabled, updated_at, updated_by_user_id)
SELECT id, 'CALENDAR', 1, updated_at, created_by_user_id FROM workspaces;
