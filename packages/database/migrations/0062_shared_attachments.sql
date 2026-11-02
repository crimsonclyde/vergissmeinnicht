CREATE TABLE `attachment_quota_overrides` (
	`user_id` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_override_bounds" CHECK("attachment_quota_overrides"."bytes" between 0 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE `attachment_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`keys` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`bytes` integer NOT NULL,
	`expires_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_reservation_bounds" CHECK("attachment_reservations"."bytes" between 1 and 102000000)
);
--> statement-breakpoint
CREATE TABLE `attachment_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_upload_bytes` integer DEFAULT 20000000 NOT NULL,
	`default_quota_bytes` integer DEFAULT 500000000 NOT NULL,
	`server_limit_bytes` integer,
	`formats` text DEFAULT '["JPEG","PNG"]' NOT NULL,
	CONSTRAINT "attachment_settings_bounds" CHECK("attachment_settings"."id" = 1 and "attachment_settings"."max_upload_bytes" between 1000000 and 100000000 and "attachment_settings"."default_quota_bytes" between 0 and 1000000000000 and ("attachment_settings"."server_limit_bytes" is null or "attachment_settings"."server_limit_bytes" between 100000000 and 1000000000000000) and json_valid("attachment_settings"."formats"))
);
--> statement-breakpoint
CREATE TABLE `attachments` (
 `deleting` integer DEFAULT false NOT NULL,
 `policy_key` text DEFAULT 'journal' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`owner_id` text,
	`uploaded_by_user_id` text,
 `charge_user_id` text,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`original_key` text NOT NULL,
	`preview_key` text NOT NULL,
	`preview_bytes` integer NOT NULL,
	`preview_hash` text NOT NULL,
	`thumbnail_key` text NOT NULL,
	`thumbnail_bytes` integer NOT NULL,
	`thumbnail_hash` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_scope" CHECK(("attachments"."workspace_id" is null) != ("attachments"."owner_id" is null)),
	CONSTRAINT "attachment_bounds" CHECK("attachments"."bytes" between 1 and 100000000 and "attachments"."preview_bytes" between 1 and 1500000 and "attachments"."thumbnail_bytes" between 1 and 500000 and "attachments"."width" > 0 and "attachments"."height" > 0 and "attachments"."width" * "attachments"."height" <= 50000000 and length("attachments"."name") between 1 and 255 and "attachments"."format" in ('JPEG','PNG')),
	CONSTRAINT "attachment_hash" CHECK(length("attachments"."sha256") = 64 and "attachments"."sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `attachment_scope_owner` ON `attachments` (`workspace_id`,`owner_id`,`uploaded_by_user_id`);--> statement-breakpoint
CREATE TABLE `journal_attachment_references` (
	`entry_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `attachment_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `private_journal_attachment_references` (
	`entry_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `attachment_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `private_journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO attachment_settings (id) VALUES (1);
--> statement-breakpoint
CREATE TRIGGER attachment_identity BEFORE UPDATE OF policy_key,id,workspace_id,owner_id,uploaded_by_user_id,charge_user_id,name,format,bytes,sha256,original_key,width,height,at ON attachments BEGIN SELECT RAISE(ABORT,'immutable attachment'); END;
--> statement-breakpoint
CREATE TRIGGER attachment_private_owner BEFORE INSERT ON attachments WHEN NEW.owner_id IS NOT NULL AND (NEW.uploaded_by_user_id IS NULL OR NEW.owner_id != NEW.uploaded_by_user_id OR NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.owner_id AND status = 'ACTIVE')) BEGIN SELECT RAISE(ABORT,'invalid private owner'); END;
--> statement-breakpoint
CREATE TRIGGER journal_attachment_scope BEFORE INSERT ON journal_attachment_references WHEN NOT EXISTS(SELECT 1 FROM attachments a JOIN journal_entries e ON e.id = NEW.entry_id WHERE a.id = NEW.attachment_id AND a.workspace_id = NEW.workspace_id AND e.workspace_id = NEW.workspace_id AND a.deleting = 0 AND a.policy_key = 'journal') BEGIN SELECT RAISE(ABORT,'attachment scope'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_attachment_scope BEFORE INSERT ON private_journal_attachment_references WHEN NOT EXISTS(SELECT 1 FROM attachments a JOIN private_journal_entries e ON e.id = NEW.entry_id WHERE a.id = NEW.attachment_id AND a.owner_id = NEW.owner_id AND e.owner_id = NEW.owner_id AND a.deleting = 0 AND a.policy_key = 'journal') BEGIN SELECT RAISE(ABORT,'attachment scope'); END;
--> statement-breakpoint
CREATE TRIGGER journal_attachment_immutable BEFORE UPDATE ON journal_attachment_references BEGIN SELECT RAISE(ABORT,'immutable reference'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_attachment_immutable BEFORE UPDATE ON private_journal_attachment_references BEGIN SELECT RAISE(ABORT,'immutable reference'); END;
