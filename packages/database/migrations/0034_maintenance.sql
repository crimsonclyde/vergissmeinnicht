CREATE TABLE `maintenance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`date` text,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`completed_on` text,
	`description` text DEFAULT '' NOT NULL,
	`contact_id` text,
	`cost_amount` text,
	`cost_currency` text,
	`category_key` text DEFAULT '' NOT NULL,
	`sort_date` text NOT NULL,
	`search_text` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by_display_name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`deleted_by_display_name` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "maintenance_records_id_uuid" CHECK(length("maintenance_records"."id") = 36),
	CONSTRAINT "maintenance_records_title_present" CHECK(length(trim("maintenance_records"."title")) > 0 and length("maintenance_records"."title") <= 200),
	CONSTRAINT "maintenance_records_text_bounded" CHECK(length("maintenance_records"."category") <= 60 and length("maintenance_records"."description") <= 4000),
	CONSTRAINT "maintenance_records_status_valid" CHECK(status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "maintenance_records_dates_format" CHECK(("maintenance_records"."date" is null or "maintenance_records"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') and ("maintenance_records"."completed_on" is null or "maintenance_records"."completed_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') and "maintenance_records"."sort_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "maintenance_records_completion_consistent" CHECK(("maintenance_records"."status" = 'COMPLETED') = ("maintenance_records"."completed_on" is not null)),
	CONSTRAINT "maintenance_records_cost_consistent" CHECK(("maintenance_records"."cost_amount" is null) = ("maintenance_records"."cost_currency" is null)),
	CONSTRAINT "maintenance_records_cost_shape" CHECK("maintenance_records"."cost_amount" is null or (length("maintenance_records"."cost_amount") <= 16 and "maintenance_records"."cost_amount" not glob '*[^0-9.]*' and length("maintenance_records"."cost_currency") = 3 and "maintenance_records"."cost_currency" not glob '*[^A-Z]*')),
	CONSTRAINT "maintenance_records_revision_positive" CHECK("maintenance_records"."revision" >= 1),
	CONSTRAINT "maintenance_records_deletion_consistent" CHECK(("maintenance_records"."deleted_at" is null) = ("maintenance_records"."deleted_by_user_id" is null) and ("maintenance_records"."deleted_at" is null) = ("maintenance_records"."deleted_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_records_id_workspace_unique` ON `maintenance_records` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `maintenance_records_list_idx` ON `maintenance_records` (`workspace_id`,`sort_date`,`id`) WHERE "maintenance_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `maintenance_records_board_idx` ON `maintenance_records` (`workspace_id`,`status`,`sort_date`) WHERE "maintenance_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `maintenance_records_contact_idx` ON `maintenance_records` (`workspace_id`,`contact_id`);--> statement-breakpoint
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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('DOCUMENTS', 'CONTACTS', 'MAINTENANCE'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Maintenance (steps.md 16.7). The tables above were generated; everything below is written by hand.
-- Who created a record, and where it belongs, never changes.
CREATE TRIGGER `maintenance_records_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `maintenance_records`
BEGIN
	SELECT RAISE(ABORT, 'maintenance record identity is immutable');
END;
--> statement-breakpoint
-- Deleting moves a record to Trash; only what is in Trash can be deleted for good.
CREATE TRIGGER `maintenance_records_no_delete`
BEFORE DELETE ON `maintenance_records`
WHEN OLD.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a maintenance record is deleted for good only from trash');
END;
--> statement-breakpoint
-- A record cannot disappear while a Link still points to it as if it were there.
CREATE TRIGGER `maintenance_records_links_marked_before_delete`
BEFORE DELETE ON `maintenance_records`
WHEN EXISTS (
	SELECT 1 FROM `links`
	WHERE (`from_type` = 'maintenance' AND `from_id` = OLD.`id` AND `from_gone_at` IS NULL)
		OR (`to_type` = 'maintenance' AND `to_id` = OLD.`id` AND `to_gone_at` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'links of the maintenance record must be marked first');
END;
--> statement-breakpoint
-- The responsible Contact, when one is set or changed, is a Contact of the same Workspace that is not
-- in Trash. (It is not a foreign key: a Contact deleted for good later leaves "a deleted contact".)
CREATE TRIGGER `maintenance_records_contact_on_insert`
BEFORE INSERT ON `maintenance_records`
WHEN NEW.`contact_id` IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM `contacts` WHERE `id` = NEW.`contact_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'the responsible contact must be a contact of the same workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `maintenance_records_contact_on_update`
BEFORE UPDATE OF `contact_id` ON `maintenance_records`
WHEN NEW.`contact_id` IS NOT NULL AND NEW.`contact_id` IS NOT OLD.`contact_id`
	AND NOT EXISTS (SELECT 1 FROM `contacts` WHERE `id` = NEW.`contact_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'the responsible contact must be a contact of the same workspace');
END;
--> statement-breakpoint
-- Links now also connect a MaintenanceRecord to a Document, a Procedure, a Run or a Schedule: the
-- trigger of 0033 is replaced. Both ends still have to exist in the Link's own Workspace.
DROP TRIGGER `links_ends_exist`;
--> statement-breakpoint
CREATE TRIGGER `links_ends_exist`
BEFORE INSERT ON `links`
WHEN NOT CASE NEW.`from_type`
	WHEN 'document' THEN
		EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`from_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
		AND CASE NEW.`to_type`
			WHEN 'document' THEN EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
			WHEN 'procedure' THEN EXISTS (SELECT 1 FROM `procedures` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
			WHEN 'schedule' THEN EXISTS (SELECT 1 FROM `schedules` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
			WHEN 'contact' THEN EXISTS (SELECT 1 FROM `contacts` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
			ELSE 0
		END
	WHEN 'contact' THEN
		EXISTS (SELECT 1 FROM `contacts` WHERE `id` = NEW.`from_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
		AND NEW.`to_type` = 'procedure'
		AND EXISTS (SELECT 1 FROM `procedures` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
	WHEN 'maintenance' THEN
		EXISTS (SELECT 1 FROM `maintenance_records` WHERE `id` = NEW.`from_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
		AND CASE NEW.`to_type`
			WHEN 'document' THEN EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
			WHEN 'procedure' THEN EXISTS (SELECT 1 FROM `procedures` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
			WHEN 'run' THEN EXISTS (SELECT 1 FROM `runs` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
			WHEN 'schedule' THEN EXISTS (SELECT 1 FROM `schedules` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
			ELSE 0
		END
	ELSE 0
END
BEGIN
	SELECT RAISE(ABORT, 'a link needs two records of its own workspace');
END;
