CREATE TABLE `document_file_texts` (
	`file_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`state` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`error_code` text,
	`source` text,
	`text` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`queued_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`,`workspace_id`) REFERENCES `document_files`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_file_texts_state_valid" CHECK(state in ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'NOT_APPLICABLE')),
	CONSTRAINT "document_file_texts_source_valid" CHECK("document_file_texts"."source" is null or "document_file_texts"."source" in ('EMBEDDED', 'OCR', 'MIXED', 'NONE')),
	CONSTRAINT "document_file_texts_priority_valid" CHECK("document_file_texts"."priority" in (0, 1)),
	CONSTRAINT "document_file_texts_attempts_valid" CHECK("document_file_texts"."attempts" >= 0),
	CONSTRAINT "document_file_texts_text_bounded" CHECK(length("document_file_texts"."text") <= 200000 and "document_file_texts"."bytes" >= 0 and "document_file_texts"."pages" >= 0),
	CONSTRAINT "document_file_texts_done_consistent" CHECK(("document_file_texts"."state" = 'DONE') = ("document_file_texts"."source" is not null) and ("document_file_texts"."state" = 'DONE' or "document_file_texts"."text" = '')),
	CONSTRAINT "document_file_texts_error_bounded" CHECK("document_file_texts"."error_code" is null or length("document_file_texts"."error_code") <= 40)
);
--> statement-breakpoint
CREATE INDEX `document_file_texts_queue_idx` ON `document_file_texts` (`state`,`priority`,`queued_at`);--> statement-breakpoint
CREATE INDEX `document_file_texts_workspace_idx` ON `document_file_texts` (`workspace_id`,`state`);--> statement-breakpoint
CREATE TABLE `document_suggestion_dismissals` (
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`dismissed_by_user_id` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `key`),
	FOREIGN KEY (`dismissed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`,`workspace_id`) REFERENCES `documents`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_suggestion_dismissals_key_bounded" CHECK(length("document_suggestion_dismissals"."key") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `text_recognition` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TRIGGER `document_file_texts_identity_immutable` BEFORE UPDATE OF `file_id`, `workspace_id` ON `document_file_texts` BEGIN SELECT RAISE(ABORT, 'document_file_texts identity is immutable'); END;
--> statement-breakpoint
-- P5: recognition is on by default, and existing files are processed too — behind new uploads (priority 1).
-- Nothing can be read from a password-protected PDF or a HEIC (no decoder, HT1).
INSERT INTO `document_file_texts` (`file_id`, `workspace_id`, `state`, `priority`, `queued_at`, `updated_at`)
SELECT `id`, `workspace_id`,
       CASE WHEN `format` = 'HEIC' OR `encrypted` = 1 THEN 'NOT_APPLICABLE' ELSE 'QUEUED' END,
       1, `created_at`, cast(unixepoch('subsecond') * 1000 as integer)
FROM `document_files`;
