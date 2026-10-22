-- Infraestructura del programador. No activa el correo ni importa mensajes.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Supabase administra las ACL de net; ese esquema no debe exponerse en la Data API.
-- La cola contiene temporalmente el encabezado Bearer. No publicar vistas/RPC de ella.

CREATE SCHEMA IF NOT EXISTS agentec_private;
REVOKE ALL ON SCHEMA agentec_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS agentec_private.ticket_mail_schedule (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  endpoint TEXT NOT NULL CHECK (endpoint LIKE 'https://%/api/tickets/mail/process'),
  request_id BIGINT,
  requested_at TIMESTAMPTZ
);
ALTER TABLE agentec_private.ticket_mail_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agentec_private.ticket_mail_schedule FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION agentec_private.dispatch_ticket_mail()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target TEXT;
  worker_secret TEXT;
  new_request_id BIGINT;
BEGIN
  SELECT endpoint INTO STRICT target FROM agentec_private.ticket_mail_schedule WHERE id = TRUE;
  SELECT decrypted_secret INTO STRICT worker_secret FROM vault.decrypted_secrets
    WHERE name = 'agentec-ticket-mail-worker';
  IF length(worker_secret) < 32 THEN
    RAISE EXCEPTION 'El programador de correo no tiene una credencial válida';
  END IF;
  SELECT net.http_post(
    url := target,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || worker_secret),
    timeout_milliseconds := 65000
  ) INTO new_request_id;
  UPDATE agentec_private.ticket_mail_schedule
    SET request_id = new_request_id, requested_at = clock_timestamp() WHERE id = TRUE;
  RETURN new_request_id;
END;
$$;
REVOKE ALL ON FUNCTION agentec_private.dispatch_ticket_mail() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION agentec_private.dispatch_ticket_mail() IS
  'Invocación de correo de Agentec: secreto en Vault y ejecución HTTP asíncrona. Sólo mantenimiento.';
