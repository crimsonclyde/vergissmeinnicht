CREATE TABLE `progress_awards` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "progress_key" CHECK(length("progress_awards"."key") = 64 and "progress_awards"."key" not glob '*[^0-9a-f]*'),
	CONSTRAINT "progress_points" CHECK(typeof("progress_awards"."points") = 'integer' and "progress_awards"."points" between 0 and 20)
);
--> statement-breakpoint
CREATE INDEX `progress_owner_time` ON `progress_awards` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE equipment_records ADD COLUMN replacement_parts text CONSTRAINT equipment_parts_bound CHECK(replacement_parts is null or length(replacement_parts) <= 2000);
--> statement-breakpoint
ALTER TABLE equipment_records ADD COLUMN custom_fields text CONSTRAINT equipment_fields_bound CHECK(custom_fields is null or (json_valid(custom_fields) and json_type(custom_fields) = 'array' and json_array_length(custom_fields) <= 16 and length(custom_fields) <= 24000));
--> statement-breakpoint
CREATE TRIGGER equipment_details_insert BEFORE INSERT ON equipment_records WHEN NEW.custom_fields IS NOT NULL BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.custom_fields) f WHERE json_type(f.value) <> 'object' OR (SELECT count(*) FROM json_each(f.value)) <> 2 OR json_type(f.value,'$.label') IS NOT 'text' OR json_type(f.value,'$.value') IS NOT 'text' OR length(trim(json_extract(f.value,'$.label'))) NOT BETWEEN 1 AND 60 OR length(trim(json_extract(f.value,'$.value'))) NOT BETWEEN 1 AND 500) THEN RAISE(ABORT,'invalid equipment details') END;
END;
--> statement-breakpoint
CREATE TRIGGER equipment_details_update BEFORE UPDATE OF custom_fields ON equipment_records WHEN NEW.custom_fields IS NOT NULL BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.custom_fields) f WHERE json_type(f.value) <> 'object' OR (SELECT count(*) FROM json_each(f.value)) <> 2 OR json_type(f.value,'$.label') IS NOT 'text' OR json_type(f.value,'$.value') IS NOT 'text' OR length(trim(json_extract(f.value,'$.label'))) NOT BETWEEN 1 AND 60 OR length(trim(json_extract(f.value,'$.value'))) NOT BETWEEN 1 AND 500) THEN RAISE(ABORT,'invalid equipment details') END;
END;
--> statement-breakpoint
CREATE TRIGGER progress_active_owner BEFORE INSERT ON progress_awards WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND status='ACTIVE') BEGIN SELECT RAISE(ABORT,'progress requires active owner'); END;
--> statement-breakpoint
CREATE TRIGGER progress_immutable BEFORE UPDATE ON progress_awards BEGIN SELECT RAISE(ABORT,'progress is immutable'); END;
