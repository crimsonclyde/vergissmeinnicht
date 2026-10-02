ALTER TABLE `documents` ADD `title_key` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `tag_keys` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `search_text` text;--> statement-breakpoint
CREATE INDEX `documents_uploaded_idx` ON `documents` (`workspace_id`,`created_at`,`id`) WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `documents_modified_idx` ON `documents` (`workspace_id`,`updated_at`,`id`) WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `documents_date_idx` ON `documents` (`workspace_id`,`document_date`,`id`) WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `documents_title_idx` ON `documents` (`workspace_id`,`title_key`,`id`) WHERE "documents"."deleted_at" is null;--> statement-breakpoint
-- Finding Documents (steps.md 16.3). The columns and indexes above were generated; the trigger below is
-- written by hand. `title_key`, `tag_keys` and `search_text` hold folded text (accents and case
-- removed), which SQL cannot produce: the application writes them with every change, and the `migrate`
-- command fills them for rows that existed before this migration (`fillDocumentSearch`).
-- A Document can never be added without them — it would be invisible to search and sort unpredictably.
CREATE TRIGGER `documents_search_required`
BEFORE INSERT ON `documents`
WHEN NEW.`title_key` IS NULL OR NEW.`tag_keys` IS NULL OR NEW.`search_text` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a document needs its search columns');
END;
