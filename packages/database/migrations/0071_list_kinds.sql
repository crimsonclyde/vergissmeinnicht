PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`deleted_by_display_name` text,
	`title_changed_at` integer DEFAULT 0 NOT NULL,
	`title_changed_by_display_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lists_id_uuid" CHECK(length("__new_lists"."id") = 36),
	CONSTRAINT "lists_kind_valid" CHECK(kind in ('GROCERY', 'TODO')),
	CONSTRAINT "lists_title_present" CHECK(length(trim("__new_lists"."title")) > 0 and length("__new_lists"."title") <= 80),
	CONSTRAINT "lists_revision_positive" CHECK("__new_lists"."revision" >= 1),
	CONSTRAINT "lists_deletion_consistent" CHECK(("__new_lists"."deleted_at" is null) = ("__new_lists"."deleted_by_user_id" is null) and ("__new_lists"."deleted_at" is null) = ("__new_lists"."deleted_by_display_name" is null))
);
--> statement-breakpoint
INSERT INTO `__new_lists`("id", "workspace_id", "kind", "title", "revision", "created_by_user_id", "created_by_display_name", "created_at", "updated_at", "deleted_at", "deleted_by_user_id", "deleted_by_display_name", "title_changed_at", "title_changed_by_display_name") SELECT "id", "workspace_id", "kind", "title", "revision", "created_by_user_id", "created_by_display_name", "created_at", "updated_at", "deleted_at", "deleted_by_user_id", "deleted_by_display_name", "title_changed_at", "title_changed_by_display_name" FROM `lists`;--> statement-breakpoint
DROP TABLE `lists`;--> statement-breakpoint
ALTER TABLE `__new_lists` RENAME TO `lists`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `lists_workspace_idx` ON `lists` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_workspace_unique` ON `lists` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TRIGGER lists_kind_immutable BEFORE UPDATE OF kind ON lists
WHEN NEW.kind <> OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'list kind cannot change');
END;
--> statement-breakpoint
CREATE TRIGGER list_items_todo_insert BEFORE INSERT ON list_items
WHEN (NEW.quantity IS NOT NULL OR NEW.unit IS NOT NULL)
  AND EXISTS (SELECT 1 FROM lists WHERE id = NEW.list_id AND workspace_id = NEW.workspace_id AND kind = 'TODO')
BEGIN
  SELECT RAISE(ABORT, 'to-do tasks only have a title');
END;
--> statement-breakpoint
CREATE TRIGGER list_items_todo_update BEFORE UPDATE OF quantity, unit, list_id, workspace_id ON list_items
WHEN (NEW.quantity IS NOT NULL OR NEW.unit IS NOT NULL)
  AND EXISTS (SELECT 1 FROM lists WHERE id = NEW.list_id AND workspace_id = NEW.workspace_id AND kind = 'TODO')
BEGIN
  SELECT RAISE(ABORT, 'to-do tasks only have a title');
END;
