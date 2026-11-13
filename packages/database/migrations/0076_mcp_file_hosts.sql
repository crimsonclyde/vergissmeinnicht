CREATE TABLE `mcp_file_hosts` (
	`host` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`refused_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	`decided_by_user_id` text,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mcp_file_host_status" CHECK("mcp_file_hosts"."status" in ('REFUSED','ALLOWED')),
	CONSTRAINT "mcp_file_host_length" CHECK(length("mcp_file_hosts"."host") between 4 and 253)
);
--> statement-breakpoint
CREATE INDEX `mcp_file_host_seen` ON `mcp_file_hosts` (`last_seen_at`);