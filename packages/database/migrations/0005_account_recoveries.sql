CREATE TABLE `account_recoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`reset_password` integer NOT NULL,
	`reset_totp` integer NOT NULL,
	`issued_by_user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issued_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_recoveries_scope" CHECK("account_recoveries"."reset_password" = 1 or "account_recoveries"."reset_totp" = 1),
	CONSTRAINT "account_recoveries_token_hash_format" CHECK(length("account_recoveries"."token_hash") = 64),
	CONSTRAINT "account_recoveries_expiry_after_creation" CHECK("account_recoveries"."expires_at" > "account_recoveries"."created_at"),
	CONSTRAINT "account_recoveries_single_outcome" CHECK("account_recoveries"."completed_at" is null or "account_recoveries"."revoked_at" is null),
	CONSTRAINT "account_recoveries_not_self_issued" CHECK("account_recoveries"."issued_by_user_id" is null or "account_recoveries"."issued_by_user_id" <> "account_recoveries"."user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_recoveries_token_hash_unique` ON `account_recoveries` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_recoveries_user_id_idx` ON `account_recoveries` (`user_id`);