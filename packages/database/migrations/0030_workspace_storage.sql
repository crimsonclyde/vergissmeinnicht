ALTER TABLE `workspaces` ADD `storage_limit_bytes` integer;--> statement-breakpoint
-- Workspace storage, Trash and permanent deletion (steps.md 16.4). The column above was generated;
-- everything below is written by hand.
-- The ceiling (set by the instance admin) stays a positive number of bytes (the trigger of 16.1 is
-- kept); the allowed range, 100 MB to 1000 GB, is the application's rule. Every existing Workspace has
-- 5 GB — more than any image quota of 14.3 (100 MB to 1 GB) — so the change to one combined limit
-- reduces nobody's storage. `image_quota_bytes` stays in the table and is no longer read.
-- The Workspace's own limit: none, or positive and never above the ceiling. (Lowering the ceiling
-- below it later is allowed: the lower of the two applies.)
CREATE TRIGGER `workspaces_storage_limit_valid`
BEFORE UPDATE OF `storage_limit_bytes` ON `workspaces`
WHEN NEW.`storage_limit_bytes` IS NOT NULL
	AND (NEW.`storage_limit_bytes` < 1 OR NEW.`storage_limit_bytes` > NEW.`storage_quota_bytes`)
BEGIN
	SELECT RAISE(ABORT, 'invalid storage limit');
END;
--> statement-breakpoint
-- Permanent deletion (16.4): a Document or Folder can be deleted for good — but only out of Trash.
-- What is not in Trash can still never be deleted, whatever code asks for it.
DROP TRIGGER `documents_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `documents_delete_only_from_trash`
BEFORE DELETE ON `documents`
WHEN OLD.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a document is deleted for good only from Trash');
END;
--> statement-breakpoint
DROP TRIGGER `document_folders_no_delete`;
--> statement-breakpoint
CREATE TRIGGER `document_folders_delete_only_from_trash`
BEFORE DELETE ON `document_folders`
WHEN OLD.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'a folder is deleted for good only from Trash');
END;
