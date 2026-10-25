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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT', 'MOON', 'JOURNAL', 'GAMIFICATION'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE user_preferences ADD COLUMN private_gamification integer DEFAULT 1 NOT NULL CONSTRAINT user_preferences_private_gamification CHECK(private_gamification in (0, 1));
--> statement-breakpoint
-- Preserve existing encouragement; newly created/restored Workspaces still start without this flag.
INSERT INTO workspace_tools (workspace_id,tool,enabled,updated_at,updated_by_user_id) SELECT id,'GAMIFICATION',1,cast(unixepoch('subsecond') * 1000 as integer),created_by_user_id FROM workspaces;
--> statement-breakpoint
UPDATE workspaces SET tools_revision=tools_revision+1;
