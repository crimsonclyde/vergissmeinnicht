CREATE TABLE `contact_keys` (
	`contact_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	PRIMARY KEY(`contact_id`, `kind`, `key`),
	FOREIGN KEY (`contact_id`,`workspace_id`) REFERENCES `contacts`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_keys_kind_valid" CHECK(kind in ('email', 'phone', 'name'))
);
--> statement-breakpoint
CREATE INDEX `contact_keys_lookup_idx` ON `contact_keys` (`workspace_id`,`kind`,`key`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`organisation` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`emails` text DEFAULT '[]' NOT NULL,
	`phones` text DEFAULT '[]' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`sort_key` text NOT NULL,
	`category_key` text DEFAULT '' NOT NULL,
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
	CONSTRAINT "contacts_id_uuid" CHECK(length("contacts"."id") = 36),
	CONSTRAINT "contacts_name_present" CHECK(length(trim("contacts"."name")) > 0 and length("contacts"."name") <= 200),
	CONSTRAINT "contacts_text_bounded" CHECK(length("contacts"."organisation") <= 200 and length("contacts"."category") <= 60 and length("contacts"."address") <= 500 and length("contacts"."notes") <= 4000),
	CONSTRAINT "contacts_website_http" CHECK("contacts"."website" = '' or (length("contacts"."website") <= 500 and ("contacts"."website" like 'http://%' or "contacts"."website" like 'https://%'))),
	CONSTRAINT "contacts_emails_array" CHECK(json_valid("contacts"."emails") and json_type("contacts"."emails") = 'array' and json_array_length("contacts"."emails") <= 10),
	CONSTRAINT "contacts_phones_array" CHECK(json_valid("contacts"."phones") and json_type("contacts"."phones") = 'array' and json_array_length("contacts"."phones") <= 10),
	CONSTRAINT "contacts_revision_positive" CHECK("contacts"."revision" >= 1),
	CONSTRAINT "contacts_deletion_consistent" CHECK(("contacts"."deleted_at" is null) = ("contacts"."deleted_by_user_id" is null) and ("contacts"."deleted_at" is null) = ("contacts"."deleted_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_id_workspace_unique` ON `contacts` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `contacts_name_idx` ON `contacts` (`workspace_id`,`sort_key`,`id`) WHERE "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `contacts_trash_idx` ON `contacts` (`workspace_id`,`deleted_at`);--> statement-breakpoint
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
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('DOCUMENTS', 'CONTACTS'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_tools`("workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id") SELECT "workspace_id", "tool", "enabled", "updated_at", "updated_by_user_id" FROM `workspace_tools`;--> statement-breakpoint
DROP TABLE `workspace_tools`;--> statement-breakpoint
ALTER TABLE `__new_workspace_tools` RENAME TO `workspace_tools`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
-- Contacts (steps.md 16.6). The tables above were generated; everything below is written by hand.
-- Who created a Contact, and where it belongs, never changes.
CREATE TRIGGER `contacts_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `contacts`
BEGIN
	SELECT RAISE(ABORT, 'contact identity is immutable');
END;
--> statement-breakpoint
-- Deleting moves a Contact to Trash; only what is in Trash can be deleted for good.
CREATE TRIGGER `contacts_no_delete`
BEFORE DELETE ON `contacts`
WHEN OLD.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a contact is deleted for good only from trash');
END;
--> statement-breakpoint
-- A Contact cannot disappear while a Link still points to it as if it were there: permanent deletion
-- marks its end of every Link as gone first.
CREATE TRIGGER `contacts_links_marked_before_delete`
BEFORE DELETE ON `contacts`
WHEN EXISTS (
	SELECT 1 FROM `links`
	WHERE (`from_type` = 'contact' AND `from_id` = OLD.`id` AND `from_gone_at` IS NULL)
		OR (`to_type` = 'contact' AND `to_id` = OLD.`id` AND `to_gone_at` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'links of the contact must be marked first');
END;
--> statement-breakpoint
-- Links now also connect a Document to a Contact, and a Contact to a Procedure: the trigger of 0031
-- is replaced (as it announced). Both ends still have to exist in the Link's own Workspace.
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
	ELSE 0
END
BEGIN
	SELECT RAISE(ABORT, 'a link needs two records of its own workspace');
END;
