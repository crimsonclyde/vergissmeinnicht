CREATE TABLE gazette_header_images (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  jpeg BLOB NOT NULL CHECK (typeof(jpeg) = 'blob' AND length(jpeg) BETWEEN 4 AND 700000 AND substr(jpeg, 1, 3) = x'ffd8ff')
);
--> statement-breakpoint
CREATE INDEX gazette_header_images_workspace ON gazette_header_images(workspace_id);
--> statement-breakpoint
CREATE TABLE gazette_header_settings (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  settings TEXT NOT NULL CHECK (json_valid(settings) AND length(settings) <= 4096),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
--> statement-breakpoint
ALTER TABLE gazette_editions ADD COLUMN header TEXT CONSTRAINT gazette_edition_header_valid CHECK (header IS NULL OR (json_valid(header) AND length(header) <= 128));
