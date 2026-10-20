-- 23.4: photos deleted from the Workspace gallery that a Run snapshot or a deleted Procedure still shows (the
-- immutable row stays; the gallery leaves them out). Cascades with the image when housekeeping deletes it.
CREATE TABLE `step_image_removals` (
	`image_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`removed_by_user_id` text NOT NULL,
	`removed_at` integer NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `step_images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
