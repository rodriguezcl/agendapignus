CREATE TABLE IF NOT EXISTS pignus_product_overrides (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  last_request TEXT NOT NULL,
  photo_type TEXT,
  photo_bytes BYTEA,
  CHECK ((photo_type IS NULL) = (photo_bytes IS NULL))
);
ALTER TABLE pignus_product_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_product_overrides FROM PUBLIC, anon, authenticated;
