CREATE TABLE `ask_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text,
	`messages` text NOT NULL,
	`sources` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ask_conversation_size" CHECK(length("ask_conversations"."messages")<=180000 and length("ask_conversations"."sources")<=10000)
);
--> statement-breakpoint
CREATE INDEX `ask_conversations_owner` ON `ask_conversations` (`owner_id`);--> statement-breakpoint
CREATE TABLE `ask_policies` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ask_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`lookups` integer DEFAULT false NOT NULL,
	`cap` integer DEFAULT 0 NOT NULL,
	`model` text DEFAULT 'gpt-5.4-mini-2026-03-17' NOT NULL,
	CONSTRAINT "ask_settings_valid" CHECK("ask_settings"."id"=1 and "ask_settings"."cap" between 0 and 1000000000 and "ask_settings"."model"='gpt-5.4-mini-2026-03-17')
);
--> statement-breakpoint
CREATE TABLE `ask_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`month` text NOT NULL,
	`charge` integer NOT NULL,
	`pending` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ask_charge_valid" CHECK("ask_usage"."charge" between 0 and 100000000)
);
--> statement-breakpoint
CREATE INDEX `ask_usage_month` ON `ask_usage` (`month`);
--> statement-breakpoint
CREATE TRIGGER ask_conversation_binding_immutable BEFORE UPDATE OF id, owner_id, workspace_id ON ask_conversations
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.workspace_id IS NOT OLD.workspace_id
BEGIN SELECT RAISE(ABORT,'immutable chat binding'); END;
