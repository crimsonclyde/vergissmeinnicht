CREATE TABLE `equipment_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`manufacturer` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`serial_number` text DEFAULT '' NOT NULL,
	`purchase_date` text,
	`warranty_expiry` text,
	`notes` text DEFAULT '' NOT NULL,
	`category_key` text NOT NULL,
	`location_key` text NOT NULL,
	`manufacturer_key` text NOT NULL,
	`sort_key` text NOT NULL,
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
	CONSTRAINT "equipment_records_name_present" CHECK(length(trim("equipment_records"."name")) > 0 and length("equipment_records"."name") <= 200),
	CONSTRAINT "equipment_records_text_bounded" CHECK(length("equipment_records"."category") <= 60 and length("equipment_records"."location") <= 200 and length("equipment_records"."manufacturer") <= 200 and length("equipment_records"."model") <= 200 and length("equipment_records"."serial_number") <= 200 and length("equipment_records"."notes") <= 4000),
	CONSTRAINT "equipment_records_dates_format" CHECK(("equipment_records"."purchase_date" is null or "equipment_records"."purchase_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') and ("equipment_records"."warranty_expiry" is null or "equipment_records"."warranty_expiry" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
	CONSTRAINT "equipment_records_revision_positive" CHECK("equipment_records"."revision" >= 1),
	CONSTRAINT "equipment_records_deletion_consistent" CHECK(("equipment_records"."deleted_at" is null) = ("equipment_records"."deleted_by_user_id" is null) and ("equipment_records"."deleted_at" is null) = ("equipment_records"."deleted_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_records_id_workspace_unique` ON `equipment_records` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `equipment_records_list_idx` ON `equipment_records` (`workspace_id`,`sort_key`,`id`) WHERE "equipment_records"."deleted_at" is null;--> statement-breakpoint
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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER equipment_identity_immutable BEFORE UPDATE OF id,workspace_id,created_by_user_id,created_by_display_name,created_at ON equipment_records BEGIN SELECT RAISE(ABORT,'equipment identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER equipment_no_delete BEFORE DELETE ON equipment_records WHEN OLD.deleted_at IS NULL BEGIN SELECT RAISE(ABORT,'equipment is deleted for good only from trash'); END;
--> statement-breakpoint
CREATE TRIGGER equipment_links_marked_before_delete BEFORE DELETE ON equipment_records WHEN EXISTS (SELECT 1 FROM links WHERE (from_type='equipment' AND from_id=OLD.id AND from_gone_at IS NULL) OR (to_type='equipment' AND to_id=OLD.id AND to_gone_at IS NULL)) BEGIN SELECT RAISE(ABORT,'equipment links must be marked first'); END;
--> statement-breakpoint
DROP TRIGGER links_ends_exist;
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
			WHEN 'equipment' THEN EXISTS (SELECT 1 FROM equipment_records WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
			ELSE 0
		END
	WHEN 'equipment' THEN
		EXISTS (SELECT 1 FROM equipment_records WHERE id=NEW.from_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
		AND CASE NEW.to_type
			WHEN 'document' THEN EXISTS (SELECT 1 FROM documents WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
			WHEN 'contact' THEN EXISTS (SELECT 1 FROM contacts WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
			WHEN 'maintenance' THEN EXISTS (SELECT 1 FROM maintenance_records WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id AND deleted_at IS NULL)
			WHEN 'procedure' THEN EXISTS (SELECT 1 FROM procedures WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id)
			WHEN 'schedule' THEN EXISTS (SELECT 1 FROM schedules WHERE id=NEW.to_id AND workspace_id=NEW.workspace_id)
			ELSE 0
		END
	ELSE 0
END
BEGIN
	SELECT RAISE(ABORT, 'a link needs two records of its own workspace');
END;
