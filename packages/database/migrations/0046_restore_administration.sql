-- 18c: restore administration. Where each historical identity came from (written by the restore, in its
-- transaction; only IMPORTED users), and the database's own bound for the server admin's restore upload limit
-- (100 MB to 1 TB, as the application checks it).
CREATE TABLE `historical_identity_origins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`restore_job_id` text NOT NULL,
	`restored_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `historical_identity_origins_workspace_idx` ON `historical_identity_origins` (`workspace_id`);--> statement-breakpoint
CREATE TRIGGER `historical_identity_origins_imported_only` BEFORE INSERT ON `historical_identity_origins` WHEN (SELECT `status` FROM `users` WHERE `id` = NEW.`user_id`) IS NOT 'IMPORTED' BEGIN SELECT RAISE(ABORT, 'only a historical identity has a restore origin'); END;--> statement-breakpoint
CREATE TRIGGER `historical_identity_origins_immutable` BEFORE UPDATE ON `historical_identity_origins` BEGIN SELECT RAISE(ABORT, 'a restore origin is history'); END;--> statement-breakpoint
CREATE TRIGGER `instance_settings_restore_limit_valid` BEFORE UPDATE OF `workspace_restore_max_bytes` ON `instance_settings` WHEN NEW.`workspace_restore_max_bytes` NOT BETWEEN 100000000 AND 1000000000000 BEGIN SELECT RAISE(ABORT, 'invalid restore upload limit'); END;--> statement-breakpoint
CREATE TRIGGER `instance_settings_restore_limit_valid_insert` BEFORE INSERT ON `instance_settings` WHEN NEW.`workspace_restore_max_bytes` NOT BETWEEN 100000000 AND 1000000000000 BEGIN SELECT RAISE(ABORT, 'invalid restore upload limit'); END;
