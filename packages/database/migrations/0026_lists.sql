CREATE TABLE `list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`quantity` text,
	`unit` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`checked_at` integer,
	`checked_by_user_id` text,
	`checked_by_display_name` text,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`list_id`,`workspace_id`) REFERENCES `lists`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "list_items_id_uuid" CHECK(length("list_items"."id") = 36),
	CONSTRAINT "list_items_title_present" CHECK(length(trim("list_items"."title")) > 0 and length("list_items"."title") <= 120),
	CONSTRAINT "list_items_quantity_format" CHECK("list_items"."quantity" is null or (length("list_items"."quantity") between 1 and 9 and "list_items"."quantity" not glob '*[^0-9.]*')),
	CONSTRAINT "list_items_unit_bounded" CHECK("list_items"."unit" is null or (length(trim("list_items"."unit")) > 0 and length("list_items"."unit") <= 16)),
	CONSTRAINT "list_items_revision_positive" CHECK("list_items"."revision" >= 1),
	CONSTRAINT "list_items_position_valid" CHECK("list_items"."position" >= 0),
	CONSTRAINT "list_items_check_consistent" CHECK(("list_items"."checked_at" is null) = ("list_items"."checked_by_user_id" is null) and ("list_items"."checked_at" is null) = ("list_items"."checked_by_display_name" is null))
);
--> statement-breakpoint
CREATE INDEX `list_items_list_idx` ON `list_items` (`list_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`deleted_by_display_name` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lists_id_uuid" CHECK(length("lists"."id") = 36),
	CONSTRAINT "lists_kind_valid" CHECK(kind in ('GROCERY')),
	CONSTRAINT "lists_title_present" CHECK(length(trim("lists"."title")) > 0 and length("lists"."title") <= 80),
	CONSTRAINT "lists_revision_positive" CHECK("lists"."revision" >= 1),
	CONSTRAINT "lists_deletion_consistent" CHECK(("lists"."deleted_at" is null) = ("lists"."deleted_by_user_id" is null) and ("lists"."deleted_at" is null) = ("lists"."deleted_by_display_name" is null))
);
--> statement-breakpoint
CREATE INDEX `lists_workspace_idx` ON `lists` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_workspace_unique` ON `lists` (`id`,`workspace_id`);