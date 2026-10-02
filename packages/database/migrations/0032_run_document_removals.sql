CREATE TABLE `run_document_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`run_document_id` text NOT NULL,
	`reason` text NOT NULL,
	`files` integer NOT NULL,
	`linked_by_display_name` text NOT NULL,
	`linked_at` integer NOT NULL,
	`removed_by_user_id` text NOT NULL,
	`removed_by_display_name` text NOT NULL,
	`removed_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_document_removals_id_uuid" CHECK(length("run_document_removals"."id") = 36),
	CONSTRAINT "run_document_removals_reason_present" CHECK(length(trim("run_document_removals"."reason")) > 0 and length("run_document_removals"."reason") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_document_removals_document_unique` ON `run_document_removals` (`run_document_id`);--> statement-breakpoint
CREATE INDEX `run_document_removals_run_idx` ON `run_document_removals` (`workspace_id`,`run_id`);
--> statement-breakpoint
-- Removing a Document version from a finished Run (steps.md 16.5, P4 — decided 2026-10-02). The table
-- above was generated; everything below is written by hand.
-- A note is written for a version that exists, of a finished Run of the same Workspace …
CREATE TRIGGER `run_document_removals_valid`
BEFORE INSERT ON `run_document_removals`
WHEN NOT EXISTS (
	SELECT 1 FROM `run_documents` d JOIN `runs` r ON r.`id` = d.`run_id`
	WHERE d.`id` = NEW.`run_document_id` AND d.`run_id` = NEW.`run_id` AND d.`workspace_id` = NEW.`workspace_id` AND r.`state` <> 'ACTIVE'
)
BEGIN
	SELECT RAISE(ABORT, 'a removal note belongs to a kept document of a finished run');
END;
--> statement-breakpoint
-- … and stays for good, exactly as written.
CREATE TRIGGER `run_document_removals_immutable`
BEFORE UPDATE ON `run_document_removals`
BEGIN
	SELECT RAISE(ABORT, 'a removal note is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER `run_document_removals_no_delete`
BEFORE DELETE ON `run_document_removals`
BEGIN
	SELECT RAISE(ABORT, 'a removal note is permanent');
END;
--> statement-breakpoint
-- A kept version can be taken away while the Run is ACTIVE (as before) — or, from a finished Run, only
-- when its removal note has been written in the same transaction. Without a note it stays.
DROP TRIGGER `run_documents_delete_only_while_active`;
--> statement-breakpoint
CREATE TRIGGER `run_documents_delete_needs_note`
BEFORE DELETE ON `run_documents`
WHEN NOT EXISTS (SELECT 1 FROM `runs` WHERE `id` = OLD.`run_id` AND `state` = 'ACTIVE')
	AND NOT EXISTS (SELECT 1 FROM `run_document_removals` WHERE `run_document_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'a document version of a finished run cannot be removed');
END;
--> statement-breakpoint
DROP TRIGGER `run_document_files_delete_only_while_active`;
--> statement-breakpoint
CREATE TRIGGER `run_document_files_delete_needs_note`
BEFORE DELETE ON `run_document_files`
WHEN NOT EXISTS (SELECT 1 FROM `run_documents` d JOIN `runs` r ON r.`id` = d.`run_id` WHERE d.`id` = OLD.`run_document_id` AND r.`state` = 'ACTIVE')
	AND NOT EXISTS (SELECT 1 FROM `run_document_removals` WHERE `run_document_id` = OLD.`run_document_id`)
BEGIN
	SELECT RAISE(ABORT, 'a document version of a finished run cannot be removed');
END;
