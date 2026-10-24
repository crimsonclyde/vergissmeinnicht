CREATE TABLE `user_avatars` (
	`user_id` text PRIMARY KEY NOT NULL,
	`jpeg` blob NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_avatars_jpeg_valid" CHECK(typeof("user_avatars"."jpeg") = 'blob' and length("user_avatars"."jpeg") between 4 and 60000 and substr("user_avatars"."jpeg", 1, 3) = x'ffd8ff')
);
