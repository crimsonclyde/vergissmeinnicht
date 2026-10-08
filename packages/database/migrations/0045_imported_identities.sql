-- 18b: historical identities (status IMPORTED) for restored Workspace backups. `users` is rebuilt with the
-- SQLite table-rebuild procedure (as 0019) because its status CHECK changes: same columns, data and unique
-- index; the new CHECK users_imported_identity ties IMPORTED to the reserved @imported.invalid address and
-- forbids server admin and verified flags for it. runMigrations applies migrations with foreign keys off and
-- verifies foreign keys and integrity afterwards (a failure rolls the whole migration back).
-- The triggers below enforce in the database what the application also refuses: a historical identity never
-- gets a membership, a session, a sign-in account, a TOTP secret, recovery codes, an account recovery, a Telegram
-- link or pairing, a weather credential or a reminder, and never turns into an account (or an account into one).
-- workspace_restore_marks: the four insert triggers that require link ends, a Run's source Document, a removed
-- Run document or a maintenance contact to be present (and not in Trash) skip the rows of a Workspace marked as
-- being restored — only inside that restore's transaction, which checks every reference itself; a mark is
-- refused for a Workspace with members. Each trigger is otherwise recreated exactly as before.
CREATE TABLE `workspace_restore_marks` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`server_admin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "users_id_uuid" CHECK(length("__new_users"."id") = 36),
	CONSTRAINT "users_email_normalized" CHECK("__new_users"."email" = lower(trim("__new_users"."email")) and length("__new_users"."email") <= 254),
	CONSTRAINT "users_display_name_present" CHECK(length(trim("__new_users"."display_name")) > 0),
	CONSTRAINT "users_status_valid" CHECK(status in ('ACTIVE', 'DISABLED', 'IMPORTED')),
	CONSTRAINT "users_imported_identity" CHECK(("__new_users"."status" = 'IMPORTED') = ("__new_users"."email" like '%@imported.invalid') and ("__new_users"."status" <> 'IMPORTED' or ("__new_users"."server_admin" = 0 and "__new_users"."email_verified" = 0)))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "display_name", "email", "email_verified", "image", "status", "server_admin", "created_at", "updated_at") SELECT "id", "display_name", "email", "email_verified", "image", "status", "server_admin", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `workspace_restore_max_bytes` integer DEFAULT 20000000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_backup_jobs` ADD `preview` text;--> statement-breakpoint
DROP TRIGGER `links_ends_exist`;--> statement-breakpoint
CREATE TRIGGER `links_ends_exist`
BEFORE INSERT ON `links`
WHEN NOT EXISTS (SELECT 1 FROM `workspace_restore_marks` WHERE `workspace_id` = NEW.`workspace_id`) AND (
NOT CASE NEW.`from_type`
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
)
BEGIN
	SELECT RAISE(ABORT, 'a link needs two records of its own workspace');
END;--> statement-breakpoint
DROP TRIGGER `run_documents_same_workspace`;--> statement-breakpoint
CREATE TRIGGER `run_documents_same_workspace`
BEFORE INSERT ON `run_documents`
WHEN NOT EXISTS (SELECT 1 FROM `workspace_restore_marks` WHERE `workspace_id` = NEW.`workspace_id`) AND (
NOT EXISTS (SELECT 1 FROM `runs` WHERE `id` = NEW.`run_id` AND `workspace_id` = NEW.`workspace_id`)
	OR NOT EXISTS (SELECT 1 FROM `documents` WHERE `id` = NEW.`source_document_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'a run keeps documents of its own workspace');
END;--> statement-breakpoint
DROP TRIGGER `run_document_removals_valid`;--> statement-breakpoint
CREATE TRIGGER `run_document_removals_valid`
BEFORE INSERT ON `run_document_removals`
WHEN NOT EXISTS (SELECT 1 FROM `workspace_restore_marks` WHERE `workspace_id` = NEW.`workspace_id`) AND (
NOT EXISTS (
	SELECT 1 FROM `run_documents` d JOIN `runs` r ON r.`id` = d.`run_id`
	WHERE d.`id` = NEW.`run_document_id` AND d.`run_id` = NEW.`run_id` AND d.`workspace_id` = NEW.`workspace_id` AND r.`state` <> 'ACTIVE'
)
)
BEGIN
	SELECT RAISE(ABORT, 'a removal note belongs to a kept document of a finished run');
END;--> statement-breakpoint
DROP TRIGGER `maintenance_records_contact_on_insert`;--> statement-breakpoint
CREATE TRIGGER `maintenance_records_contact_on_insert`
BEFORE INSERT ON `maintenance_records`
WHEN NOT EXISTS (SELECT 1 FROM `workspace_restore_marks` WHERE `workspace_id` = NEW.`workspace_id`) AND (
NEW.`contact_id` IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM `contacts` WHERE `id` = NEW.`contact_id` AND `workspace_id` = NEW.`workspace_id` AND `deleted_at` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'the responsible contact must be a contact of the same workspace');
END;--> statement-breakpoint
CREATE TRIGGER `workspace_restore_marks_new_only` BEFORE INSERT ON `workspace_restore_marks` WHEN EXISTS (SELECT 1 FROM `memberships` WHERE `workspace_id` = NEW.`workspace_id`) BEGIN SELECT RAISE(ABORT, 'only a workspace being restored is marked'); END;--> statement-breakpoint
CREATE TRIGGER `memberships_no_imported_insert` BEFORE INSERT ON `memberships` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no memberships'); END;--> statement-breakpoint
CREATE TRIGGER `memberships_no_imported_update` BEFORE UPDATE OF `user_id` ON `memberships` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no memberships'); END;--> statement-breakpoint
CREATE TRIGGER `sessions_no_imported_insert` BEFORE INSERT ON `sessions` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities cannot sign in'); END;--> statement-breakpoint
CREATE TRIGGER `sessions_no_imported_update` BEFORE UPDATE OF `user_id` ON `sessions` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities cannot sign in'); END;--> statement-breakpoint
CREATE TRIGGER `accounts_no_imported_insert` BEFORE INSERT ON `accounts` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no sign-in accounts'); END;--> statement-breakpoint
CREATE TRIGGER `accounts_no_imported_update` BEFORE UPDATE OF `user_id` ON `accounts` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no sign-in accounts'); END;--> statement-breakpoint
CREATE TRIGGER `totp_credentials_no_imported_insert` BEFORE INSERT ON `totp_credentials` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no second factor'); END;--> statement-breakpoint
CREATE TRIGGER `totp_credentials_no_imported_update` BEFORE UPDATE OF `user_id` ON `totp_credentials` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no second factor'); END;--> statement-breakpoint
CREATE TRIGGER `recovery_codes_no_imported_insert` BEFORE INSERT ON `recovery_codes` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no recovery codes'); END;--> statement-breakpoint
CREATE TRIGGER `recovery_codes_no_imported_update` BEFORE UPDATE OF `user_id` ON `recovery_codes` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no recovery codes'); END;--> statement-breakpoint
CREATE TRIGGER `account_recoveries_no_imported_insert` BEFORE INSERT ON `account_recoveries` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities cannot be recovered'); END;--> statement-breakpoint
CREATE TRIGGER `account_recoveries_no_imported_update` BEFORE UPDATE OF `user_id` ON `account_recoveries` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities cannot be recovered'); END;--> statement-breakpoint
CREATE TRIGGER `telegram_links_no_imported_insert` BEFORE INSERT ON `telegram_links` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `telegram_links_no_imported_update` BEFORE UPDATE OF `user_id` ON `telegram_links` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `telegram_pairings_no_imported_insert` BEFORE INSERT ON `telegram_pairings` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `telegram_pairings_no_imported_update` BEFORE UPDATE OF `user_id` ON `telegram_pairings` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `scheduled_reminders_no_imported_insert` BEFORE INSERT ON `scheduled_reminders` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`recipient_user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no reminders'); END;--> statement-breakpoint
CREATE TRIGGER `scheduled_reminders_no_imported_update` BEFORE UPDATE OF `recipient_user_id` ON `scheduled_reminders` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`recipient_user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no reminders'); END;--> statement-breakpoint
CREATE TRIGGER `notification_summaries_no_imported_insert` BEFORE INSERT ON `notification_summaries` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`recipient_user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `notification_summaries_no_imported_update` BEFORE UPDATE OF `recipient_user_id` ON `notification_summaries` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`recipient_user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities receive no notifications'); END;--> statement-breakpoint
CREATE TRIGGER `weather_credentials_no_imported_insert` BEFORE INSERT ON `weather_credentials` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no credentials'); END;--> statement-breakpoint
CREATE TRIGGER `weather_credentials_no_imported_update` BEFORE UPDATE OF `user_id` ON `weather_credentials` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'imported identities have no credentials'); END;--> statement-breakpoint
CREATE TRIGGER `users_imported_stays_imported` BEFORE UPDATE OF `status`, `email` ON `users` WHEN OLD.`status` = 'IMPORTED' AND (NEW.`status` <> 'IMPORTED' OR NEW.`email` <> OLD.`email`) BEGIN SELECT RAISE(ABORT, 'a historical identity never becomes an account'); END;--> statement-breakpoint
CREATE TRIGGER `users_account_never_imported` BEFORE UPDATE OF `status` ON `users` WHEN OLD.`status` <> 'IMPORTED' AND NEW.`status` = 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'an account never becomes a historical identity'); END;
