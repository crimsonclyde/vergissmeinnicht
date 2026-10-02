CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`from_gone_at` integer,
	`from_gone_by_display_name` text,
	`to_gone_at` integer,
	`to_gone_by_display_name` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "links_id_uuid" CHECK(length("links"."id") = 36),
	CONSTRAINT "links_ends_differ" CHECK("links"."from_type" <> "links"."to_type" or "links"."from_id" <> "links"."to_id"),
	CONSTRAINT "links_from_gone_consistent" CHECK(("links"."from_gone_at" is null) = ("links"."from_gone_by_display_name" is null)),
	CONSTRAINT "links_to_gone_consistent" CHECK(("links"."to_gone_at" is null) = ("links"."to_gone_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_pair_unique` ON `links` (`workspace_id`,`from_type`,`from_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `links_to_idx` ON `links` (`workspace_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE TABLE `run_document_files` (
	`run_document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`run_document_id`, `position`),
	FOREIGN KEY (`run_document_id`) REFERENCES `run_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`workspace_id`) REFERENCES `document_files`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `run_document_files_file_idx` ON `run_document_files` (`file_id`);--> statement-breakpoint
CREATE TABLE `run_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`title` text NOT NULL,
	`type_key` text,
	`type_name` text,
	`document_date` text,
	`year` integer,
	`notes` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`linked_by_user_id` text NOT NULL,
	`linked_by_display_name` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_documents_id_uuid" CHECK(length("run_documents"."id") = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_documents_source_unique` ON `run_documents` (`run_id`,`source_document_id`);--> statement-breakpoint
CREATE INDEX `run_documents_source_idx` ON `run_documents` (`workspace_id`,`source_document_id`);
--> statement-breakpoint
-- Links (steps.md 16.5, HT8). The tables above were generated; everything below is written by hand.
-- Both ends of a Link exist in the Link's own Workspace when it is added: a Link across Workspaces,
-- or to something that does not exist, is refused here whatever code asks for it. Adding a record
-- type later means replacing this trigger, not rebuilding the table.
CREATE TRIGGER `links_ends_exist`
BEFORE INSERT ON `links`
WHEN NOT (
	NEW.`from_type` = 'document'
	AND EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`from_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
	AND CASE NEW.`to_type`
		WHEN 'document' THEN EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
		WHEN 'procedure' THEN EXISTS (SELECT 1 FROM `procedures` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
		WHEN 'schedule' THEN EXISTS (SELECT 1 FROM `schedules` WHERE `id` = NEW.`to_id` AND `workspace_id` = NEW.`workspace_id`)
		ELSE 0
	END
)
BEGIN
	SELECT RAISE(ABORT, 'a link needs two records of its own workspace');
END;
--> statement-breakpoint
-- What a Link connects never changes; only an end can be marked as gone.
CREATE TRIGGER `links_identity_immutable`
BEFORE UPDATE OF `id`, `workspace_id`, `from_type`, `from_id`, `to_type`, `to_id`, `created_by_user_id`, `created_by_display_name`, `created_at` ON `links`
BEGIN
	SELECT RAISE(ABORT, 'link identity is immutable');
END;
--> statement-breakpoint
-- A Document cannot disappear while a Link still points to it as if it were there: permanent
-- deletion marks its end of every Link as gone first.
CREATE TRIGGER `documents_links_marked_before_delete`
BEFORE DELETE ON `documents`
WHEN EXISTS (
	SELECT 1 FROM `links`
	WHERE (`from_type` = 'document' AND `from_id` = OLD.`id` AND `from_gone_at` IS NULL)
		OR (`to_type` = 'document' AND `to_id` = OLD.`id` AND `to_gone_at` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'links of the document must be marked first');
END;
--> statement-breakpoint
-- A Document version is retained for a Run of the same Workspace, from a Document that is there (not in Trash).
CREATE TRIGGER `run_documents_same_workspace`
BEFORE INSERT ON `run_documents`
WHEN NOT EXISTS (SELECT 1 FROM `runs` WHERE `id` = NEW.`run_id` AND `workspace_id` = NEW.`workspace_id`)
	OR NOT EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`source_document_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'a run keeps documents of its own workspace');
END;
--> statement-breakpoint
-- A retained version is evidence: it is never changed …
CREATE TRIGGER `run_documents_immutable`
BEFORE UPDATE ON `run_documents`
BEGIN
	SELECT RAISE(ABORT, 'a retained document version is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `run_document_files_immutable`
BEFORE UPDATE ON `run_document_files`
BEGIN
	SELECT RAISE(ABORT, 'a retained document version is immutable');
END;
--> statement-breakpoint
-- … and it can be taken away only while the Run is still ACTIVE (steps.md P4).
CREATE TRIGGER `run_documents_delete_only_while_active`
BEFORE DELETE ON `run_documents`
WHEN NOT EXISTS (SELECT 1 FROM `runs` WHERE `id` = OLD.`run_id` AND `state` = 'ACTIVE')
BEGIN
	SELECT RAISE(ABORT, 'a document version of a finished run cannot be removed');
END;
--> statement-breakpoint
CREATE TRIGGER `run_document_files_delete_only_while_active`
BEFORE DELETE ON `run_document_files`
WHEN NOT EXISTS (SELECT 1 FROM `run_documents` d JOIN `runs` r ON r.`id` = d.`run_id` WHERE d.`id` = OLD.`run_document_id` AND r.`state` = 'ACTIVE')
BEGIN
	SELECT RAISE(ABORT, 'a document version of a finished run cannot be removed');
END;
--> statement-breakpoint
-- The files of a retained version belong to the same Workspace as the version.
CREATE TRIGGER `run_document_files_same_workspace`
BEFORE INSERT ON `run_document_files`
WHEN NOT EXISTS (SELECT 1 FROM `run_documents` WHERE `id` = NEW.`run_document_id` AND `workspace_id` = NEW.`workspace_id`)
BEGIN
	SELECT RAISE(ABORT, 'a run keeps documents of its own workspace');
END;
