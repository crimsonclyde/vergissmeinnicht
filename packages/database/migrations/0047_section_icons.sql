-- 22.1: an optional icon per Section, copied into the Run snapshot. run_sections stays immutable (trigger
-- run_sections_immutable from 0011 covers every column). NULL = no icon (the Run shows a default).
ALTER TABLE `procedure_sections` ADD `icon` text REFERENCES procedure_icons(key);--> statement-breakpoint
ALTER TABLE `run_sections` ADD `icon` text REFERENCES procedure_icons(key);