CREATE SCHEMA IF NOT EXISTS agentec_private;
REVOKE ALL ON SCHEMA agentec_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS agentec_private.push_schedule (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), endpoint TEXT NOT NULL,
  request_id BIGINT, requested_at TIMESTAMPTZ
);
ALTER TABLE agentec_private.push_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agentec_private.push_schedule FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION agentec_private.dispatch_web_push() RETURNS BIGINT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target TEXT; secret TEXT; request BIGINT;
BEGIN
  SELECT endpoint INTO STRICT target FROM agentec_private.push_schedule WHERE id=TRUE;
  SELECT decrypted_secret INTO STRICT secret FROM vault.decrypted_secrets WHERE name='pignus-web-push-worker';
  IF length(secret)<32 THEN RAISE EXCEPTION 'Credencial Web Push no válida'; END IF;
  SELECT net.http_post(url:=target, body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    timeout_milliseconds:=55000) INTO request;
  UPDATE agentec_private.push_schedule SET request_id=request,requested_at=clock_timestamp() WHERE id=TRUE;
  RETURN request;
END;
$$;
REVOKE ALL ON FUNCTION agentec_private.dispatch_web_push() FROM PUBLIC, anon, authenticated;
