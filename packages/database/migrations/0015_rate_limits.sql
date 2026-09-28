CREATE TABLE `rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`window_start` integer NOT NULL,
	`window_ms` integer NOT NULL,
	CONSTRAINT "rate_limits_key_hash_format" CHECK(length("rate_limits"."key_hash") = 64),
	CONSTRAINT "rate_limits_counts_positive" CHECK("rate_limits"."hits" > 0 and "rate_limits"."window_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX `rate_limits_window_idx` ON `rate_limits` (`window_start`);