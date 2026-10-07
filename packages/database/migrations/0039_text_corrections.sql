PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_document_file_texts` (
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
	`corrected_text` text,
	`corrected_search_text` text,
	`correction_bytes` integer DEFAULT 0 NOT NULL,
	`corrected_by_user_id` text,
	`corrected_by_display_name` text,
	`corrected_at` integer,
	`text_revision` integer DEFAULT 0 NOT NULL,
	`queued_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`corrected_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`workspace_id`) REFERENCES `document_files`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_file_texts_state_valid" CHECK(state in ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'NOT_APPLICABLE')),
	CONSTRAINT "document_file_texts_source_valid" CHECK("__new_document_file_texts"."source" is null or "__new_document_file_texts"."source" in ('EMBEDDED', 'OCR', 'MIXED', 'NONE')),
	CONSTRAINT "document_file_texts_priority_valid" CHECK("__new_document_file_texts"."priority" in (0, 1)),
	CONSTRAINT "document_file_texts_attempts_valid" CHECK("__new_document_file_texts"."attempts" >= 0),
	CONSTRAINT "document_file_texts_text_bounded" CHECK(length("__new_document_file_texts"."text") <= 200000 and "__new_document_file_texts"."bytes" >= 0 and "__new_document_file_texts"."pages" >= 0),
	CONSTRAINT "document_file_texts_done_consistent" CHECK(("__new_document_file_texts"."state" = 'DONE') = ("__new_document_file_texts"."source" is not null) and ("__new_document_file_texts"."state" = 'DONE' or "__new_document_file_texts"."text" = '')),
	CONSTRAINT "document_file_texts_error_bounded" CHECK("__new_document_file_texts"."error_code" is null or length("__new_document_file_texts"."error_code") <= 40),
	CONSTRAINT "document_file_texts_correction_consistent" CHECK(("__new_document_file_texts"."corrected_text" is null) = ("__new_document_file_texts"."corrected_search_text" is null) and ("__new_document_file_texts"."corrected_text" is null) = ("__new_document_file_texts"."corrected_at" is null) and ("__new_document_file_texts"."corrected_text" is null) = ("__new_document_file_texts"."corrected_by_display_name" is null) and ("__new_document_file_texts"."corrected_text" is not null or "__new_document_file_texts"."correction_bytes" = 0)),
	CONSTRAINT "document_file_texts_correction_bounded" CHECK(("__new_document_file_texts"."corrected_text" is null or length("__new_document_file_texts"."corrected_text") <= 200000) and "__new_document_file_texts"."correction_bytes" >= 0 and "__new_document_file_texts"."text_revision" >= 0)
);
--> statement-breakpoint
-- 16.13: corrections start empty; every existing row keeps its machine reading unchanged.
INSERT INTO `__new_document_file_texts`("file_id", "workspace_id", "state", "priority", "attempts", "lease_until", "error_code", "source", "text", "search_text", "bytes", "pages", "truncated", "queued_at", "updated_at") SELECT "file_id", "workspace_id", "state", "priority", "attempts", "lease_until", "error_code", "source", "text", "search_text", "bytes", "pages", "truncated", "queued_at", "updated_at" FROM `document_file_texts`;--> statement-breakpoint
DROP TABLE `document_file_texts`;--> statement-breakpoint
ALTER TABLE `__new_document_file_texts` RENAME TO `document_file_texts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `document_file_texts_queue_idx` ON `document_file_texts` (`state`,`priority`,`queued_at`);--> statement-breakpoint
CREATE INDEX `document_file_texts_workspace_idx` ON `document_file_texts` (`workspace_id`,`state`);--> statement-breakpoint
-- Dropped with the old table: the identity of a text row stays immutable (as in 0038).
CREATE TRIGGER `document_file_texts_identity_immutable` BEFORE UPDATE OF `file_id`, `workspace_id` ON `document_file_texts` BEGIN SELECT RAISE(ABORT, 'document_file_texts identity is immutable'); END;
