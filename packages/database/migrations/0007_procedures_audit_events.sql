CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_display_name` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_subject_idx` ON `audit_events` (`workspace_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedures_id_uuid" CHECK(length("procedures"."id") = 36),
	CONSTRAINT "procedures_title_present" CHECK(length(trim("procedures"."title")) > 0 and length("procedures"."title") <= 120),
	CONSTRAINT "procedures_description_bounded" CHECK(length("procedures"."description") <= 4000),
	CONSTRAINT "procedures_icon_valid" CHECK(icon in ('checklist', 'home', 'kitchen', 'cleaning', 'laundry', 'garden', 'pet', 'car', 'travel', 'tools', 'health', 'shopping', 'document', 'security', 'star')),
	CONSTRAINT "procedures_tags_array" CHECK(json_valid("procedures"."tags") and json_type("procedures"."tags") = 'array' and json_array_length("procedures"."tags") <= 10),
	CONSTRAINT "procedures_revision_positive" CHECK("procedures"."revision" >= 1),
	CONSTRAINT "procedures_deletion_consistent" CHECK(("procedures"."deleted_at" is null) = ("procedures"."deleted_by_user_id" is null))
);
--> statement-breakpoint
CREATE INDEX `procedures_workspace_idx` ON `procedures` (`workspace_id`,`deleted_at`);