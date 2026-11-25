BEGIN;
SELECT pg_advisory_xact_lock(hashtext('cctv-services-schema-v1'));
CREATE TABLE IF NOT EXISTS pignus_cctv_dossiers (
  customer_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version>=0),
  updated_at TEXT,
  pending_improvements INTEGER NOT NULL DEFAULT 0,
  equipment_count INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pignus_cctv_attachments (
  customer_id TEXT NOT NULL REFERENCES pignus_cctv_dossiers(customer_id),
  id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=3145728),
  digest TEXT NOT NULL,
  content BYTEA NOT NULL,
  created_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  PRIMARY KEY(customer_id,id)
);
CREATE TABLE IF NOT EXISTS pignus_cctv_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES pignus_cctv_dossiers(customer_id),
  fingerprint TEXT NOT NULL,
  result_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pignus_cctv_commands_customer ON pignus_cctv_commands (customer_id,created_at);
ALTER TABLE pignus_cctv_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pignus_cctv_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pignus_cctv_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_cctv_dossiers, pignus_cctv_attachments, pignus_cctv_commands FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE pignus_cctv_dossiers, pignus_cctv_attachments, pignus_cctv_commands FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE pignus_cctv_dossiers, pignus_cctv_attachments, pignus_cctv_commands FROM authenticated;
  END IF;
END $$;
COMMIT;
