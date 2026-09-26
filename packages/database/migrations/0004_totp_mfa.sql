CREATE TABLE `mfa_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mfa_challenges_token_hash_format" CHECK(length("mfa_challenges"."token_hash") = 64),
	CONSTRAINT "mfa_challenges_expiry_after_creation" CHECK("mfa_challenges"."expires_at" > "mfa_challenges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mfa_challenges_token_hash_unique` ON `mfa_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mfa_challenges_user_id_idx` ON `mfa_challenges` (`user_id`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `totp_credentials`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recovery_codes_hash_format" CHECK(length("recovery_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_codes_code_hash_unique` ON `recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `recovery_codes_user_id_idx` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `totp_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`sealed_secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`enabled_at` integer,
	`last_used_step` integer DEFAULT -1 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "totp_credentials_sealed_format" CHECK("totp_credentials"."sealed_secret" like 'v1.%'),
	CONSTRAINT "totp_credentials_failures_non_negative" CHECK("totp_credentials"."consecutive_failures" >= 0)
);
