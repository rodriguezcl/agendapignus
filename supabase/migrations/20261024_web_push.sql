CREATE TABLE IF NOT EXISTS public.pignus_push_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  public_key TEXT NOT NULL, private_key TEXT NOT NULL, subject TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public.pignus_push_subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
  subscription JSONB NOT NULL, seen JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ, lease_token TEXT, last_test_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pignus_push_user ON public.pignus_push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS pignus_push_session ON public.pignus_push_subscriptions(session_hash);
ALTER TABLE public.pignus_push_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pignus_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pignus_push_config, public.pignus_push_subscriptions FROM PUBLIC, anon, authenticated;
