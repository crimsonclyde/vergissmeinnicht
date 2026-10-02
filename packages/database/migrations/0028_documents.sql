CREATE TABLE `document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`deleted_by_display_name` text,
	`deleted_with_folder_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`workspace_id`) REFERENCES `document_folders`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_folders_id_uuid" CHECK(length("document_folders"."id") = 36),
	CONSTRAINT "document_folders_name_present" CHECK(length(trim("document_folders"."name")) > 0 and length("document_folders"."name") <= 80 and instr("document_folders"."name", '/') = 0),
	CONSTRAINT "document_folders_not_own_parent" CHECK("document_folders"."parent_id" is null or "document_folders"."parent_id" <> "document_folders"."id"),
	CONSTRAINT "document_folders_revision_positive" CHECK("document_folders"."revision" >= 1),
	CONSTRAINT "document_folders_deletion_consistent" CHECK(("document_folders"."deleted_at" is null) = ("document_folders"."deleted_by_user_id" is null) and ("document_folders"."deleted_at" is null) = ("document_folders"."deleted_by_display_name" is null) and ("document_folders"."deleted_at" is null) = ("document_folders"."deleted_with_folder_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_folders_id_workspace_unique` ON `document_folders` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `document_folders_parent_idx` ON `document_folders` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `document_folders_deleted_with_idx` ON `document_folders` (`deleted_with_folder_id`);--> statement-breakpoint
CREATE TABLE `document_pages` (
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`document_id`, `position`),
	FOREIGN KEY (`document_id`,`workspace_id`) REFERENCES `documents`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`workspace_id`) REFERENCES `document_files`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_pages_position_bounded" CHECK("document_pages"."position" between 0 and 49)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_pages_file_unique` ON `document_pages` (`file_id`);--> statement-breakpoint
CREATE TABLE `document_types` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`retired_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_types_id_uuid" CHECK(length("document_types"."id") = 36),
	CONSTRAINT "document_types_name_present" CHECK(length(trim("document_types"."name")) > 0 and length("document_types"."name") <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_types_id_workspace_unique` ON `document_types` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_types_name_unique` ON `document_types` (`workspace_id`,`name_key`) WHERE "document_types"."retired_at" is null;--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`type_key` text,
	`type_id` text,
	`document_date` text,
	`year` integer,
	`notes` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
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
	`deleted_with_folder_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`,`workspace_id`) REFERENCES `document_folders`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`,`workspace_id`) REFERENCES `document_types`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_id_uuid" CHECK(length("documents"."id") = 36),
	CONSTRAINT "documents_title_present" CHECK(length(trim("documents"."title")) > 0 and length("documents"."title") <= 200),
	CONSTRAINT "documents_type_single" CHECK("documents"."type_key" is null or "documents"."type_id" is null),
	CONSTRAINT "documents_type_key_valid" CHECK(type_key is null or type_key in ('bill', 'receipt', 'contract', 'tax_notice', 'manual', 'warranty', 'inspection_report', 'correspondence')),
	CONSTRAINT "documents_date_format" CHECK("documents"."document_date" is null or "documents"."document_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "documents_year_bounded" CHECK("documents"."year" is null or "documents"."year" between 1900 and 2200),
	CONSTRAINT "documents_notes_bounded" CHECK(length("documents"."notes") <= 4000),
	CONSTRAINT "documents_tags_array" CHECK(json_valid("documents"."tags") and json_type("documents"."tags") = 'array' and json_array_length("documents"."tags") <= 10),
	CONSTRAINT "documents_revision_positive" CHECK("documents"."revision" >= 1),
	CONSTRAINT "documents_deletion_consistent" CHECK(("documents"."deleted_at" is null) = ("documents"."deleted_by_user_id" is null) and ("documents"."deleted_at" is null) = ("documents"."deleted_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_id_workspace_unique` ON `documents` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `documents_folder_idx` ON `documents` (`workspace_id`,`folder_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `documents_deleted_with_idx` ON `documents` (`deleted_with_folder_id`);--> statement-breakpoint
CREATE TABLE `workspace_tools` (
	`workspace_id` text NOT NULL,
	`tool` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_tools_tool_valid" CHECK(tool in ('DOCUMENTS'))
);
--> statement-breakpoint
-- Documents (steps.md 16.2). The tables above were generated; everything below is written by hand.
-- Live sibling Folders are unique by their compared name (top-level Folders share the "parent" '').
CREATE UNIQUE INDEX `document_folders_sibling_name_unique` ON `document_folders` (`workspace_id`, coalesce(`parent_id`, ''), `name_key`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
-- A Folder can never be moved into itself or below one of its descendants: walking up from the new
-- parent must not meet the Folder. (The application checks the same inside its transaction.)
CREATE TRIGGER `document_folders_no_cycle`
BEFORE UPDATE OF `parent_id` ON `document_folders`
WHEN NEW.`parent_id` IS NOT NULL AND EXISTS (
	WITH RECURSIVE ancestors(id) AS (
		SELECT NEW.`parent_id`
		UNION
		SELECT f.`parent_id` FROM `document_folders` f JOIN ancestors a ON f.`id` = a.id WHERE f.`parent_id` IS NOT NULL
	)
	SELECT 1 FROM ancestors WHERE id = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'a folder cannot be moved into itself');
END;
--> statement-breakpoint
-- A Folder stays in its Workspace, and who created it does not change.
CREATE TRIGGER `document_folders_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `document_folders`
BEGIN
	SELECT RAISE(ABORT, 'folder identity is immutable');
END;
--> statement-breakpoint
-- "Uploaded at" and "uploaded by" of a Document never change; edits set "last modified".
CREATE TRIGGER `documents_upload_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `documents`
BEGIN
	SELECT RAISE(ABORT, 'document upload facts are immutable');
END;
--> statement-breakpoint
-- House-management records are never deleted by this schema version: deleting moves them to Trash.
-- (Permanent deletion by a Workspace admin arrives with 16.4, which replaces these two triggers.)
CREATE TRIGGER `documents_no_delete`
BEFORE DELETE ON `documents`
BEGIN
	SELECT RAISE(ABORT, 'documents are moved to Trash, not deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `document_folders_no_delete`
BEFORE DELETE ON `document_folders`
BEGIN
	SELECT RAISE(ABORT, 'folders are moved to Trash, not deleted');
END;
--> statement-breakpoint
-- A type keeps its Workspace; its name may change, and it can be retired.
CREATE TRIGGER `document_types_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `created_by_user_id`, `created_at` ON `document_types`
BEGIN
	SELECT RAISE(ABORT, 'document type identity is immutable');
END;
