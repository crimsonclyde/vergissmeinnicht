CREATE TABLE `procedure_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedure_sections_id_uuid" CHECK(length("procedure_sections"."id") = 36),
	CONSTRAINT "procedure_sections_position_bounded" CHECK("procedure_sections"."position" >= 0 and "procedure_sections"."position" < 50),
	CONSTRAINT "procedure_sections_title_present" CHECK(length(trim("procedure_sections"."title")) > 0 and length("procedure_sections"."title") <= 120),
	CONSTRAINT "procedure_sections_description_bounded" CHECK(length("procedure_sections"."description") <= 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_sections_position_unique` ON `procedure_sections` (`procedure_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_sections_id_procedure_unique` ON `procedure_sections` (`id`,`procedure_id`);--> statement-breakpoint
CREATE TABLE `procedure_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text DEFAULT 'CHECK' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text,
	`required` integer NOT NULL,
	`critical` integer NOT NULL,
	`skip_reason_policy` text NOT NULL,
	`not_applicable_reason_policy` text NOT NULL,
	FOREIGN KEY (`procedure_id`) REFERENCES `procedures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`section_id`,`procedure_id`) REFERENCES `procedure_sections`(`id`,`procedure_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedure_steps_id_uuid" CHECK(length("procedure_steps"."id") = 36),
	CONSTRAINT "procedure_steps_position_bounded" CHECK("procedure_steps"."position" >= 0 and "procedure_steps"."position" < 200),
	CONSTRAINT "procedure_steps_kind_valid" CHECK(kind in ('CHECK')),
	CONSTRAINT "procedure_steps_title_present" CHECK(length(trim("procedure_steps"."title")) > 0 and length("procedure_steps"."title") <= 200),
	CONSTRAINT "procedure_steps_description_bounded" CHECK(length("procedure_steps"."description") <= 4000),
	CONSTRAINT "procedure_steps_icon_valid" CHECK(icon is null or icon in ('checklist', 'home', 'kitchen', 'cleaning', 'laundry', 'garden', 'pet', 'car', 'travel', 'tools', 'health', 'shopping', 'document', 'security', 'star')),
	CONSTRAINT "procedure_steps_skip_policy_valid" CHECK(skip_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED')),
	CONSTRAINT "procedure_steps_na_policy_valid" CHECK(not_applicable_reason_policy in ('DISABLED', 'OPTIONAL', 'REQUIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_steps_position_unique` ON `procedure_steps` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `procedure_steps_procedure_idx` ON `procedure_steps` (`procedure_id`);