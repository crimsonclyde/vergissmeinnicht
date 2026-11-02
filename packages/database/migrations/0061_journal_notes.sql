CREATE TABLE `journal_acknowledgements` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_notice_version" CHECK("journal_acknowledgements"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `journal_drafts` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`entry_id` text,
	`expected_revision` integer NOT NULL,
	`content` text NOT NULL,
	`archived` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_draft_content" CHECK(json_valid("journal_drafts"."content") and length("journal_drafts"."content") <= 400000 and "journal_drafts"."expected_revision" >= 0 and "journal_drafts"."archived" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_draft_scope` ON `journal_drafts` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `journal_revisions` (
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`archived` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`by_name` text NOT NULL,
	`by_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `revision`),
	FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_revision_content" CHECK(json_valid("journal_revisions"."content") and length("journal_revisions"."content") <= 400000 and "journal_revisions"."revision" >= 1 and "journal_revisions"."archived" in (0,1))
);
--> statement-breakpoint
CREATE TABLE `private_journal_revisions` (
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`archived` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`by_name` text NOT NULL,
	`by_user_id` text NOT NULL,
	`owner_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `revision`),
	FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `private_journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "private_journal_revision_content" CHECK(json_valid("private_journal_revisions"."content") and length("private_journal_revisions"."content") <= 400000 and "private_journal_revisions"."revision" >= 1 and "private_journal_revisions"."archived" in (0,1))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`body` text NOT NULL,
	`collection` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`workspace_id` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_kind" CHECK("__new_journal_entries"."kind" = 'note' and "__new_journal_entries"."version" in (1, 2)),
	CONSTRAINT "journal_organization" CHECK(length("__new_journal_entries"."collection") <= 80 and json_valid("__new_journal_entries"."tags") and json_type("__new_journal_entries"."tags") = 'array' and json_array_length("__new_journal_entries"."tags") <= 10 and length("__new_journal_entries"."tags") <= 2000 and "__new_journal_entries"."pinned" in (0,1)),
	CONSTRAINT "journal_bounds" CHECK(length("__new_journal_entries"."title") between 1 and 160 and length("__new_journal_entries"."body") <= 50000 and "__new_journal_entries"."revision" >= 1 and "__new_journal_entries"."archived" in (0, 1)),
	CONSTRAINT "journal_date" CHECK(("__new_journal_entries"."date" is null and "__new_journal_entries"."version" = 2) or ("__new_journal_entries"."date" is not null and length("__new_journal_entries"."date") = 10 and date("__new_journal_entries"."date", '+0 days') is not null and date("__new_journal_entries"."date", '+0 days') = "__new_journal_entries"."date"))
);
--> statement-breakpoint
INSERT INTO `__new_journal_entries`("id", "kind", "version", "title", "date", "body", "collection", "tags", "pinned", "revision", "archived", "created_by_user_id", "created_by", "updated_by_user_id", "updated_by", "created_at", "updated_at", "workspace_id") SELECT "id", "kind", "version", "title", "date", "body", '', '[]', 0, "revision", "archived", "created_by_user_id", "created_by", "updated_by_user_id", "updated_by", "created_at", "updated_at", "workspace_id" FROM `journal_entries`;--> statement-breakpoint
DROP TABLE `journal_entries`;--> statement-breakpoint
ALTER TABLE `__new_journal_entries` RENAME TO `journal_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `journal_workspace_date` ON `journal_entries` (`workspace_id`,`archived`,`date`,`id`);--> statement-breakpoint
CREATE TABLE `__new_private_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`body` text NOT NULL,
	`collection` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`revision` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "private_journal_kind" CHECK("__new_private_journal_entries"."kind" = 'note' and "__new_private_journal_entries"."version" in (1, 2)),
	CONSTRAINT "private_journal_organization" CHECK(length("__new_private_journal_entries"."collection") <= 80 and json_valid("__new_private_journal_entries"."tags") and json_type("__new_private_journal_entries"."tags") = 'array' and json_array_length("__new_private_journal_entries"."tags") <= 10 and length("__new_private_journal_entries"."tags") <= 2000 and "__new_private_journal_entries"."pinned" in (0,1)),
	CONSTRAINT "private_journal_bounds" CHECK(length("__new_private_journal_entries"."title") between 1 and 160 and length("__new_private_journal_entries"."body") <= 50000 and "__new_private_journal_entries"."revision" >= 1 and "__new_private_journal_entries"."archived" in (0, 1)),
	CONSTRAINT "private_journal_date" CHECK(("__new_private_journal_entries"."date" is null and "__new_private_journal_entries"."version" = 2) or ("__new_private_journal_entries"."date" is not null and length("__new_private_journal_entries"."date") = 10 and date("__new_private_journal_entries"."date", '+0 days') is not null and date("__new_private_journal_entries"."date", '+0 days') = "__new_private_journal_entries"."date")),
	CONSTRAINT "private_journal_owner" CHECK("__new_private_journal_entries"."owner_id" = "__new_private_journal_entries"."created_by_user_id" and "__new_private_journal_entries"."owner_id" = "__new_private_journal_entries"."updated_by_user_id")
);
--> statement-breakpoint
INSERT INTO `__new_private_journal_entries`("id", "kind", "version", "title", "date", "body", "collection", "tags", "pinned", "revision", "archived", "created_by_user_id", "created_by", "updated_by_user_id", "updated_by", "created_at", "updated_at", "owner_id") SELECT "id", "kind", "version", "title", "date", "body", '', '[]', 0, "revision", "archived", "created_by_user_id", "created_by", "updated_by_user_id", "updated_by", "created_at", "updated_at", "owner_id" FROM `private_journal_entries`;--> statement-breakpoint
DROP TABLE `private_journal_entries`;--> statement-breakpoint
ALTER TABLE `__new_private_journal_entries` RENAME TO `private_journal_entries`;--> statement-breakpoint
CREATE INDEX `private_journal_owner_date` ON `private_journal_entries` (`owner_id`,`archived`,`date`,`id`);
--> statement-breakpoint
CREATE TRIGGER journal_identity_immutable BEFORE UPDATE OF id, workspace_id, kind, created_by_user_id, created_by, created_at ON journal_entries BEGIN SELECT RAISE(ABORT, 'journal identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_identity_immutable BEFORE UPDATE OF id, owner_id, kind, created_by_user_id, created_by, created_at ON private_journal_entries BEGIN SELECT RAISE(ABORT, 'journal identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_active_insert BEFORE INSERT ON private_journal_entries WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id AND status = 'ACTIVE') BEGIN SELECT RAISE(ABORT, 'journal owner must be active'); END;
--> statement-breakpoint
CREATE TRIGGER journal_revision_scope BEFORE INSERT ON journal_revisions WHEN NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.entry_id AND workspace_id = NEW.workspace_id) BEGIN SELECT RAISE(ABORT, 'revision scope'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_revision_scope BEFORE INSERT ON private_journal_revisions WHEN NOT EXISTS (SELECT 1 FROM private_journal_entries WHERE id = NEW.entry_id AND owner_id = NEW.owner_id) OR NEW.by_user_id != NEW.owner_id BEGIN SELECT RAISE(ABORT, 'revision scope'); END;
--> statement-breakpoint
CREATE TRIGGER journal_revisions_immutable_update BEFORE UPDATE ON journal_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER journal_revisions_immutable_delete BEFORE DELETE ON journal_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_revisions_immutable_update BEFORE UPDATE ON private_journal_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_revisions_immutable_delete BEFORE DELETE ON private_journal_revisions BEGIN SELECT RAISE(ABORT, 'immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER journal_notice_active BEFORE INSERT ON journal_acknowledgements WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND status = 'ACTIVE') BEGIN SELECT RAISE(ABORT, 'notice owner must be active'); END;

--> statement-breakpoint
INSERT INTO journal_revisions(entry_id,revision,content,archived,at,by_name,by_user_id,workspace_id) SELECT id,revision,json_object('kind',kind,'version',version,'title',title,'date',date,'body',body,'collection',collection,'tags',json(tags),'pinned',json(case when pinned then 'true' else 'false' end)),archived,updated_at,updated_by,updated_by_user_id,workspace_id FROM journal_entries;
--> statement-breakpoint
INSERT INTO private_journal_revisions(entry_id,revision,content,archived,at,by_name,by_user_id,owner_id) SELECT id,revision,json_object('kind',kind,'version',version,'title',title,'date',date,'body',body,'collection',collection,'tags',json(tags),'pinned',json(case when pinned then 'true' else 'false' end)),archived,updated_at,updated_by,updated_by_user_id,owner_id FROM private_journal_entries;
--> statement-breakpoint
CREATE TRIGGER journal_markdown_version BEFORE UPDATE OF version ON journal_entries WHEN OLD.version=2 AND NEW.version!=2 BEGIN SELECT RAISE(ABORT,'cannot downgrade Markdown'); END;
--> statement-breakpoint
CREATE TRIGGER private_journal_markdown_version BEFORE UPDATE OF version ON private_journal_entries WHEN OLD.version=2 AND NEW.version!=2 BEGIN SELECT RAISE(ABORT,'cannot downgrade Markdown'); END;
