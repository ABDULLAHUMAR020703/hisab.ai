-- Phase 2: reusable OAuth state and extended connection metadata.

ALTER TABLE public.integration_connections
  ADD COLUMN refresh_expires_at TIMESTAMPTZ,
  ADD COLUMN base_currency TEXT,
  ADD COLUMN timezone TEXT,
  ADD COLUMN legal_name TEXT,
  ADD COLUMN connected_at TIMESTAMPTZ;

CREATE TABLE public.integration_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.integration_providers(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT integration_oauth_states_expiry CHECK (expires_at > created_at),
  CONSTRAINT integration_oauth_states_hash_format CHECK (state_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX integration_oauth_states_expiry_idx
  ON public.integration_oauth_states (expires_at);
CREATE INDEX integration_oauth_states_connection_idx
  ON public.integration_oauth_states (connection_id);

ALTER TABLE public.integration_oauth_states ENABLE ROW LEVEL SECURITY;

-- OAuth state is server-only security material. Authenticated PostgREST clients
-- cannot read or mutate it directly.
CREATE POLICY integration_oauth_states_service_all ON public.integration_oauth_states
  FOR ALL TO service_role USING (true) WITH CHECK (true);
