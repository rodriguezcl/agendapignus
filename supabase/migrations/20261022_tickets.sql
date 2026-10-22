-- Tickets Agentec: esquema nuevo, sin importar datos de Zammad.
BEGIN;
CREATE TABLE IF NOT EXISTS pignus_ticket_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pignus_tickets (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT, status TEXT NOT NULL, area_id TEXT, assignee_id TEXT, created_by_id TEXT, requester_id TEXT, legacy_id TEXT UNIQUE, updated_at TEXT NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pignus_tickets_customer ON pignus_tickets (customer_id,status);
CREATE INDEX IF NOT EXISTS pignus_tickets_status ON pignus_tickets (status,updated_at);
CREATE TABLE IF NOT EXISTS pignus_ticket_entries (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pignus_ticket_entries_ticket ON pignus_ticket_entries (ticket_id,at);
CREATE TABLE IF NOT EXISTS pignus_ticket_commands (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL, ticket_id TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS pignus_ticket_aliases (number TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id));
CREATE TABLE IF NOT EXISTS pignus_ticket_service_requests (legacy_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id));
CREATE TABLE IF NOT EXISTS pignus_ticket_mail_ids (message_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), sender TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pignus_ticket_mail_cursor (
    mailbox_key TEXT PRIMARY KEY, uid_validity TEXT, last_uid INTEGER NOT NULL DEFAULT 0,
    activated_at TEXT, updated_at TEXT, last_success_at TEXT, last_error TEXT,
    lease_owner TEXT, lease_until TEXT
  );
CREATE TABLE IF NOT EXISTS pignus_ticket_mail_outbox (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, entry_id TEXT NOT NULL,
    mailbox_key TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    message_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL,
    next_attempt_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, last_error TEXT,
    result_applied INTEGER NOT NULL DEFAULT 0
  );
CREATE INDEX IF NOT EXISTS pignus_ticket_mail_outbox_pending ON pignus_ticket_mail_outbox (mailbox_key,status,next_attempt_at);
CREATE TABLE IF NOT EXISTS pignus_ticket_mail_skipped (
    mailbox_key TEXT NOT NULL, uid_validity TEXT NOT NULL, uid INTEGER NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(mailbox_key,uid_validity,uid)
  );
ALTER TABLE pignus_ticket_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_settings FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_settings FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_settings FROM authenticated; END IF; END $$;
ALTER TABLE pignus_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_tickets FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_tickets FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_tickets FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_entries FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_entries FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_entries FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_commands FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_commands FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_commands FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_aliases FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_aliases FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_aliases FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_service_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_service_requests FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_service_requests FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_service_requests FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_mail_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_mail_ids FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_mail_ids FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_mail_ids FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_mail_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_mail_cursor FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_mail_cursor FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_mail_cursor FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_mail_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_mail_outbox FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_mail_outbox FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_mail_outbox FROM authenticated; END IF; END $$;
ALTER TABLE pignus_ticket_mail_skipped ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_mail_skipped FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE pignus_ticket_mail_skipped FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE pignus_ticket_mail_skipped FROM authenticated; END IF; END $$;
COMMIT;
