PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_list_item_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "list_item_operations_id_uuid" CHECK(length("__new_list_item_operations"."id") = 36),
	CONSTRAINT "list_item_operations_kind_valid" CHECK("__new_list_item_operations"."kind" in ('MOVE', 'REMOVE', 'UPDATE', 'RESTORE')),
	CONSTRAINT "list_item_operations_result_json" CHECK(json_valid("__new_list_item_operations"."result"))
);
--> statement-breakpoint
INSERT INTO `__new_list_item_operations`("id", "user_id", "workspace_id", "kind", "payload_hash", "result", "at") SELECT "id", "user_id", "workspace_id", "kind", "payload_hash", "result", "at" FROM `list_item_operations`;--> statement-breakpoint
DROP TABLE `list_item_operations`;--> statement-breakpoint
ALTER TABLE `__new_list_item_operations` RENAME TO `list_item_operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `list_item_operations_age_idx` ON `list_item_operations` (`at`);