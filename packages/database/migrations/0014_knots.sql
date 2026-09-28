CREATE TABLE `knots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`target_type` text NOT NULL,
	`procedure_id` text,
	`run_id` text,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`revoked_by_user_id` text,
	`revoked_by_display_name` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "knots_id_uuid" CHECK(length("knots"."id") = 36),
	CONSTRAINT "knots_token_hash_format" CHECK(length("knots"."token_hash") = 64),
	CONSTRAINT "knots_label_present" CHECK(length(trim("knots"."label")) > 0 and length("knots"."label") <= 80),
	CONSTRAINT "knots_target_type_valid" CHECK(target_type in ('PROCEDURE', 'RUN')),
	CONSTRAINT "knots_target_consistent" CHECK(("knots"."target_type" = 'PROCEDURE' and "knots"."procedure_id" is not null and "knots"."run_id" is null) or ("knots"."target_type" = 'RUN' and "knots"."run_id" is not null and "knots"."procedure_id" is null)),
	CONSTRAINT "knots_expiry_after_creation" CHECK("knots"."expires_at" is null or "knots"."expires_at" > "knots"."created_at"),
	CONSTRAINT "knots_revocation_consistent" CHECK(("knots"."revoked_at" is null) = ("knots"."revoked_by_user_id" is null) and ("knots"."revoked_at" is null) = ("knots"."revoked_by_display_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knots_token_hash_unique` ON `knots` (`token_hash`);--> statement-breakpoint
CREATE INDEX `knots_workspace_idx` ON `knots` (`workspace_id`,`created_at`);--> statement-breakpoint
-- Knots are never deleted (revocation keeps the record for the audit trail).
CREATE TRIGGER `knots_no_delete`
BEFORE DELETE ON `knots`
BEGIN
	SELECT RAISE(ABORT, 'knots cannot be deleted');
END;
--> statement-breakpoint
-- Only the revocation columns may change, and only once: target, token, label, creator and
-- expiry are fixed at creation, and a revoked Knot cannot be revived.
CREATE TRIGGER `knots_only_revocation`
BEFORE UPDATE ON `knots`
WHEN OLD.`revoked_at` IS NOT NULL
	OR NEW.`id` IS NOT OLD.`id`
	OR NEW.`workspace_id` IS NOT OLD.`workspace_id`
	OR NEW.`token_hash` IS NOT OLD.`token_hash`
	OR NEW.`label` IS NOT OLD.`label`
	OR NEW.`target_type` IS NOT OLD.`target_type`
	OR NEW.`procedure_id` IS NOT OLD.`procedure_id`
	OR NEW.`run_id` IS NOT OLD.`run_id`
	OR NEW.`created_by_user_id` IS NOT OLD.`created_by_user_id`
	OR NEW.`created_by_display_name` IS NOT OLD.`created_by_display_name`
	OR NEW.`created_at` IS NOT OLD.`created_at`
	OR NEW.`expires_at` IS NOT OLD.`expires_at`
BEGIN
	SELECT RAISE(ABORT, 'only revocation can change a knot');
END;
