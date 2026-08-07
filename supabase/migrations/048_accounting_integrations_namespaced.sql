-- Provider-agnostic accounting integrations and OAuth persistence.
--
-- These objects are deliberately namespaced so they coexist with the generic
-- platform integration_connectors and integration_connections tables created
-- by migration 037. Do not point accounting providers at the platform tables.

CREATE TYPE public.accounting_integration_connection_status AS ENUM (
  'NOT_CONNECTED',
  'PENDING',
  'CONNECTED',
  'FAILED',
  'DISCONNECTED',
  'TOKEN_EXPIRED'
);

CREATE TABLE public.accounting_integration_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounting_integration_providers_slug_format
    CHECK (slug ~ '^[a-z][a-z0-9-]*$')
);

CREATE TABLE public.accounting_integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.accounting_integration_providers(id) ON DELETE RESTRICT,
  status public.accounting_integration_connection_status NOT NULL DEFAULT 'NOT_CONNECTED',
  realm_id TEXT,
  company_name TEXT,
  company_email TEXT,
  country TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  last_sync TIMESTAMPTZ,
  last_error TEXT,
  base_currency TEXT,
  timezone TEXT,
  legal_name TEXT,
  connected_at TIMESTAMPTZ,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.accounting_integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.accounting_integration_connections(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.accounting_integration_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.accounting_integration_providers(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.accounting_integration_connections(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT accounting_integration_oauth_states_expiry
    CHECK (expires_at > created_at),
  CONSTRAINT accounting_integration_oauth_states_hash_format
    CHECK (state_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX accounting_integration_connections_tenant_idx
  ON public.accounting_integration_connections (tenant_id, provider_id, updated_at DESC);

CREATE INDEX accounting_integration_logs_connection_idx
  ON public.accounting_integration_logs (connection_id, created_at DESC);

CREATE INDEX accounting_integration_oauth_states_expiry_idx
  ON public.accounting_integration_oauth_states (expires_at);

CREATE INDEX accounting_integration_oauth_states_connection_idx
  ON public.accounting_integration_oauth_states (connection_id);

-- A disconnected row is retained for audit history. Every other state represents
-- the tenant's current connection lifecycle and is unique per provider.
CREATE UNIQUE INDEX accounting_integration_connections_one_current_provider_idx
  ON public.accounting_integration_connections (tenant_id, provider_id)
  WHERE status <> 'DISCONNECTED';

CREATE TRIGGER accounting_integration_providers_set_updated_at
  BEFORE UPDATE ON public.accounting_integration_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER accounting_integration_connections_set_updated_at
  BEFORE UPDATE ON public.accounting_integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounting_integration_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_integration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_integration_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_integration_providers_read
  ON public.accounting_integration_providers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY accounting_integration_providers_service_all
  ON public.accounting_integration_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Connection rows contain encrypted credentials. Tenant-scoped server APIs
-- mediate access and return explicit token-free DTOs.
CREATE POLICY accounting_integration_connections_service_all
  ON public.accounting_integration_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY accounting_integration_logs_service_all
  ON public.accounting_integration_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- OAuth state is server-only security material.
CREATE POLICY accounting_integration_oauth_states_service_all
  ON public.accounting_integration_oauth_states
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.accounting_integration_providers (name, slug, logo, is_active)
VALUES
  ('QuickBooks Online', 'quickbooks', '/integrations/quickbooks.svg', true),
  ('Xero', 'xero', '/integrations/xero.svg', false),
  ('Zoho Books', 'zoho', '/integrations/zoho.svg', false),
  ('Sage', 'sage', '/integrations/sage.svg', false),
  ('Odoo', 'odoo', '/integrations/odoo.svg', false)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  logo = EXCLUDED.logo;
