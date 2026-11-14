ALTER TABLE gazette_watch_items ADD COLUMN discount_threshold REAL
CONSTRAINT gazette_watch_discount_threshold CHECK (discount_threshold IS NULL OR discount_threshold BETWEEN 2 AND 100);
