CREATE TABLE `list_item_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`result` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "list_item_operations_id_uuid" CHECK(length("list_item_operations"."id") = 36),
	CONSTRAINT "list_item_operations_kind_valid" CHECK("list_item_operations"."kind" in ('MOVE', 'REMOVE')),
	CONSTRAINT "list_item_operations_result_json" CHECK(json_valid("list_item_operations"."result"))
);
--> statement-breakpoint
CREATE INDEX `list_item_operations_age_idx` ON `list_item_operations` (`at`);