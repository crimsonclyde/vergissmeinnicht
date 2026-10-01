-- Instruction images (steps.md 14.3): image metadata per Workspace, one optional image + caption per Step and
-- its Run snapshot, and the Workspace image quota. Existing tables only gain columns (no rebuild).
CREATE TABLE `step_images` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "step_images_id_uuid" CHECK(length("step_images"."id") = 36),
	CONSTRAINT "step_images_sha_format" CHECK(length("step_images"."sha256") = 64 and "step_images"."sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "step_images_bytes_bounded" CHECK("step_images"."bytes" between 1 and 500000),
	CONSTRAINT "step_images_size_bounded" CHECK("step_images"."width" between 1 and 1600 and "step_images"."height" between 1 and 1600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_images_content_unique` ON `step_images` (`workspace_id`,`sha256`);
--> statement-breakpoint
CREATE INDEX `step_images_sha_idx` ON `step_images` (`sha256`);
--> statement-breakpoint
ALTER TABLE `procedure_steps` ADD `image_id` text REFERENCES step_images(id);
--> statement-breakpoint
ALTER TABLE `procedure_steps` ADD `image_caption` text;
--> statement-breakpoint
ALTER TABLE `run_steps` ADD `image_id` text REFERENCES step_images(id);
--> statement-breakpoint
ALTER TABLE `run_steps` ADD `image_caption` text;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `image_quota_bytes` integer DEFAULT 100000000 NOT NULL;
--> statement-breakpoint
CREATE INDEX `procedure_steps_image_idx` ON `procedure_steps` (`image_id`);
--> statement-breakpoint
CREATE INDEX `run_steps_image_idx` ON `run_steps` (`image_id`);
--> statement-breakpoint
-- An image always comes with its caption (1–200 characters), and a caption never without an image.
CREATE TRIGGER `procedure_steps_image_insert`
BEFORE INSERT ON `procedure_steps`
WHEN (NEW.`image_id` IS NULL) <> (NEW.`image_caption` IS NULL) OR (NEW.`image_caption` IS NOT NULL AND (length(trim(NEW.`image_caption`)) = 0 OR length(NEW.`image_caption`) > 200))
BEGIN
	SELECT RAISE(ABORT, 'step image needs a caption');
END;
--> statement-breakpoint
CREATE TRIGGER `procedure_steps_image_update`
BEFORE UPDATE OF `image_id`, `image_caption` ON `procedure_steps`
WHEN (NEW.`image_id` IS NULL) <> (NEW.`image_caption` IS NULL) OR (NEW.`image_caption` IS NOT NULL AND (length(trim(NEW.`image_caption`)) = 0 OR length(NEW.`image_caption`) > 200))
BEGIN
	SELECT RAISE(ABORT, 'step image needs a caption');
END;
--> statement-breakpoint
CREATE TRIGGER `run_steps_image_insert`
BEFORE INSERT ON `run_steps`
WHEN (NEW.`image_id` IS NULL) <> (NEW.`image_caption` IS NULL) OR (NEW.`image_caption` IS NOT NULL AND (length(trim(NEW.`image_caption`)) = 0 OR length(NEW.`image_caption`) > 200))
BEGIN
	SELECT RAISE(ABORT, 'step image needs a caption');
END;
--> statement-breakpoint
-- The Run keeps the instruction version from its Start.
CREATE TRIGGER `run_steps_image_immutable`
BEFORE UPDATE OF `image_id`, `image_caption` ON `run_steps`
BEGIN
	SELECT RAISE(ABORT, 'run snapshot is immutable');
END;
--> statement-breakpoint
-- Stored images never change; a new image is a new row.
CREATE TRIGGER `step_images_immutable`
BEFORE UPDATE ON `step_images`
BEGIN
	SELECT RAISE(ABORT, 'step images are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `workspaces_image_quota_valid`
BEFORE UPDATE OF `image_quota_bytes` ON `workspaces`
WHEN NEW.`image_quota_bytes` NOT IN (100000000, 250000000, 500000000, 1000000000)
BEGIN
	SELECT RAISE(ABORT, 'invalid image quota');
END;
