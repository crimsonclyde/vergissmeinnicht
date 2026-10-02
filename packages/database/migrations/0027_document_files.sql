CREATE TABLE `document_file_derivatives` (
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`page` integer NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`file_id`, `kind`, `page`),
	FOREIGN KEY (`file_id`) REFERENCES `document_files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_file_derivatives_kind_valid" CHECK(kind in ('THUMBNAIL', 'PREVIEW')),
	CONSTRAINT "document_file_derivatives_page_bounded" CHECK("document_file_derivatives"."page" between 0 and 499),
	CONSTRAINT "document_file_derivatives_sha_format" CHECK(length("document_file_derivatives"."sha256") = 64 and "document_file_derivatives"."sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "document_file_derivatives_bytes_positive" CHECK("document_file_derivatives"."bytes" >= 1),
	CONSTRAINT "document_file_derivatives_size_bounded" CHECK("document_file_derivatives"."width" between 1 and 2400 and "document_file_derivatives"."height" between 1 and 2400)
);
--> statement-breakpoint
CREATE INDEX `document_file_derivatives_sha_idx` ON `document_file_derivatives` (`sha256`);--> statement-breakpoint
CREATE TABLE `document_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`format` text NOT NULL,
	`original_name` text NOT NULL,
	`page_count` integer,
	`width` integer,
	`height` integer,
	`encrypted` integer DEFAULT false NOT NULL,
	`active_content` integer DEFAULT false NOT NULL,
	`preview_state` text NOT NULL,
	`preview_attempts` integer DEFAULT 0 NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`uploaded_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_files_id_uuid" CHECK(length("document_files"."id") = 36),
	CONSTRAINT "document_files_sha_format" CHECK(length("document_files"."sha256") = 64 and "document_files"."sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "document_files_bytes_bounded" CHECK("document_files"."bytes" between 1 and 100000000),
	CONSTRAINT "document_files_format_valid" CHECK(format in ('PDF', 'JPEG', 'PNG', 'HEIC')),
	CONSTRAINT "document_files_name_present" CHECK(length(trim("document_files"."original_name")) > 0 and length("document_files"."original_name") <= 255),
	CONSTRAINT "document_files_pages_bounded" CHECK("document_files"."page_count" is null or "document_files"."page_count" >= 1),
	CONSTRAINT "document_files_size_consistent" CHECK(("document_files"."width" is null) = ("document_files"."height" is null) and ("document_files"."width" is null or ("document_files"."width" >= 1 and "document_files"."height" >= 1))),
	CONSTRAINT "document_files_preview_state_valid" CHECK(preview_state in ('PENDING', 'READY', 'PARTIAL', 'FAILED', 'NONE')),
	CONSTRAINT "document_files_attempts_valid" CHECK("document_files"."preview_attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `document_files_workspace_idx` ON `document_files` (`workspace_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `document_files_sha_idx` ON `document_files` (`sha256`);--> statement-breakpoint
CREATE INDEX `document_files_preview_idx` ON `document_files` (`preview_state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_files_id_workspace_unique` ON `document_files` (`id`,`workspace_id`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `document_max_file_bytes` integer DEFAULT 50000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `document_formats` text DEFAULT 'PDF,JPEG,PNG,HEIC' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `storage_quota_bytes` integer DEFAULT 5000000000 NOT NULL;--> statement-breakpoint
-- Document files (steps.md 16.1). The tables above were generated; the triggers below are written by hand.
-- A stored file never changes: only the progress of its previews does. A new file is a new row.
CREATE TRIGGER `document_files_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `sha256`, `bytes`, `format`, `original_name`, `page_count`, `width`, `height`, `encrypted`, `active_content`, `uploaded_by_user_id`, `uploaded_by_display_name`, `created_at` ON `document_files`
BEGIN
	SELECT RAISE(ABORT, 'document files are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `document_file_derivatives_immutable`
BEFORE UPDATE ON `document_file_derivatives`
BEGIN
	SELECT RAISE(ABORT, 'derived files are immutable');
END;
--> statement-breakpoint
-- A file's row is only removed after its derived rows (no cascade: nothing disappears implicitly).
CREATE TRIGGER `document_files_delete_guard`
BEFORE DELETE ON `document_files`
WHEN EXISTS (SELECT 1 FROM `document_file_derivatives` WHERE `file_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'document file still has derived files');
END;
--> statement-breakpoint
-- The limits an instance admin may choose (H8): 1 MB to 100 MB per file, and only formats the server validates.
CREATE TRIGGER `instance_settings_document_limits_valid`
BEFORE UPDATE OF `document_max_file_bytes`, `document_formats` ON `instance_settings`
WHEN NEW.`document_max_file_bytes` NOT BETWEEN 1000000 AND 100000000
	OR length(NEW.`document_formats`) = 0
	OR replace(replace(replace(replace(replace(NEW.`document_formats`, 'PDF', ''), 'JPEG', ''), 'PNG', ''), 'HEIC', ''), ',', '') <> ''
BEGIN
	SELECT RAISE(ABORT, 'invalid document file settings');
END;
--> statement-breakpoint
CREATE TRIGGER `instance_settings_document_limits_valid_insert`
BEFORE INSERT ON `instance_settings`
WHEN NEW.`document_max_file_bytes` NOT BETWEEN 1000000 AND 100000000
	OR length(NEW.`document_formats`) = 0
	OR replace(replace(replace(replace(replace(NEW.`document_formats`, 'PDF', ''), 'JPEG', ''), 'PNG', ''), 'HEIC', ''), ',', '') <> ''
BEGIN
	SELECT RAISE(ABORT, 'invalid document file settings');
END;
--> statement-breakpoint
-- A storage limit is a positive number of bytes; lowering it never deletes anything (16.4 adds the settings).
CREATE TRIGGER `workspaces_storage_quota_valid`
BEFORE UPDATE OF `storage_quota_bytes` ON `workspaces`
WHEN NEW.`storage_quota_bytes` < 0
BEGIN
	SELECT RAISE(ABORT, 'invalid storage limit');
END;
