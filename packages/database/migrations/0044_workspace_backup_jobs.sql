-- 18a: Workspace backup jobs (export; restore from 18b). Packages live in the data volume, never in the database.
CREATE TABLE `workspace_backup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`workspace_id` text,
	`state` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`phase` text,
	`progress_done` integer NOT NULL,
	`progress_total` integer NOT NULL,
	`cancel_requested` integer NOT NULL,
	`size_bytes` integer,
	`counts` text,
	`error_code` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_backup_jobs_export_has_workspace" CHECK("workspace_backup_jobs"."kind" <> 'EXPORT' or "workspace_backup_jobs"."workspace_id" is not null),
	CONSTRAINT "workspace_backup_jobs_progress_valid" CHECK("workspace_backup_jobs"."progress_done" >= 0 and "workspace_backup_jobs"."progress_total" >= 0),
	CONSTRAINT "workspace_backup_jobs_bounded" CHECK(("workspace_backup_jobs"."counts" is null or (json_valid("workspace_backup_jobs"."counts") and length("workspace_backup_jobs"."counts") <= 4096)) and ("workspace_backup_jobs"."error_code" is null or length("workspace_backup_jobs"."error_code") <= 64) and ("workspace_backup_jobs"."phase" is null or length("workspace_backup_jobs"."phase") <= 32))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_backup_jobs_one_export` ON `workspace_backup_jobs` (`workspace_id`) WHERE "workspace_backup_jobs"."kind" = 'EXPORT' and "workspace_backup_jobs"."state" in ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX `workspace_backup_jobs_workspace_idx` ON `workspace_backup_jobs` (`workspace_id`,`created_at`);