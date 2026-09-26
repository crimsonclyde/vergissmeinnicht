CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`grants_server_admin` integer DEFAULT false NOT NULL,
	`invited_by_user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	`revoked_by_user_id` text,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_email_normalized" CHECK("invitations"."email" = lower(trim("invitations"."email"))),
	CONSTRAINT "invitations_token_hash_format" CHECK(length("invitations"."token_hash") = 64),
	CONSTRAINT "invitations_expiry_after_creation" CHECK("invitations"."expires_at" > "invitations"."created_at"),
	CONSTRAINT "invitations_single_outcome" CHECK("invitations"."accepted_at" is null or "invitations"."revoked_at" is null),
	CONSTRAINT "invitations_accepted_user_consistent" CHECK(("invitations"."accepted_at" is null) = ("invitations"."accepted_user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`type` text NOT NULL,
	`actor_user_id` text,
	`actor_label` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `security_events_subject_idx` ON `security_events` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `security_events_occurred_at_idx` ON `security_events` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `server_admin` integer DEFAULT false NOT NULL;