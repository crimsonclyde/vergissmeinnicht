ALTER TABLE lists ADD COLUMN icon TEXT CHECK (icon IN ('shopping', 'checklist', 'home', 'travel', 'garden', 'tools', 'book', 'gift'));
--> statement-breakpoint
ALTER TABLE lists ADD COLUMN cover_attachment_id TEXT REFERENCES attachments(id);
--> statement-breakpoint
CREATE UNIQUE INDEX lists_cover_attachment_unique ON lists(cover_attachment_id);
--> statement-breakpoint
CREATE TRIGGER list_cover_scope_insert BEFORE INSERT ON lists
WHEN NEW.cover_attachment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attachments WHERE id = NEW.cover_attachment_id AND workspace_id = NEW.workspace_id
    AND policy_key = 'lists' AND deleting = 0
)
BEGIN
  SELECT RAISE(ABORT, 'list cover scope');
END;
--> statement-breakpoint
CREATE TRIGGER list_cover_scope_update BEFORE UPDATE OF cover_attachment_id, workspace_id ON lists
WHEN NEW.cover_attachment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attachments WHERE id = NEW.cover_attachment_id AND workspace_id = NEW.workspace_id
    AND policy_key = 'lists' AND deleting = 0
)
BEGIN
  SELECT RAISE(ABORT, 'list cover scope');
END;
