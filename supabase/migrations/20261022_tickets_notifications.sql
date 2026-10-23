-- Avisos persistentes del ciclo de Tickets y de los plazos SLA.
-- Aplicar después de 20261022_tickets.sql. El backend crea el mismo esquema
-- de forma idempotente; no se exponen avisos mediante la Data API.
BEGIN;
CREATE TABLE IF NOT EXISTS pignus_ticket_notifications (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id),
  recipient_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pignus_ticket_notifications_recipient
  ON pignus_ticket_notifications (recipient_id,read_at,created_at);
CREATE INDEX IF NOT EXISTS pignus_ticket_notifications_ticket
  ON pignus_ticket_notifications (ticket_id,recipient_id);
ALTER TABLE pignus_ticket_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pignus_ticket_notifications FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE pignus_ticket_notifications FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE pignus_ticket_notifications FROM authenticated;
  END IF;
END $$;
COMMIT;
