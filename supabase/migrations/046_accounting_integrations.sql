-- Provider-agnostic accounting integration connection framework.

CREATE TYPE public.integration_connection_status AS ENUM (
  'NOT_CONNECTED',
  'PENDING',
  'CONNECTED',
  'FAILED',
  'DISCONNECTED',
  'TOKEN_EXPIRED'
);

CREATE TABLE public.integration_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT integration_providers_slug_format CHECK (slug ~ '^[a-z][a-z0-9-]*$')
);

CREATE TABLE public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.integration_providers(id) ON DELETE RESTRICT,
  status public.integration_connection_status NOT NULL DEFAULT 'NOT_CONNECTED',
  realm_id TEXT,
  company_name TEXT,
  company_email TEXT,
  country TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  last_sync TIMESTAMPTZ,
  last_error TEXT,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX integration_connections_tenant_idx
  ON public.integration_connections (tenant_id, provider_id, updated_at DESC);
CREATE INDEX integration_logs_connection_idx
  ON public.integration_logs (connection_id, created_at DESC);

-- A disconnected row is retained for audit history. Every other state represents
-- the tenant's current connection lifecycle and is unique per provider.
CREATE UNIQUE INDEX integration_connections_one_current_provider_idx
  ON public.integration_connections (tenant_id, provider_id)
  WHERE status <> 'DISCONNECTED';

CREATE TRIGGER integration_providers_set_updated_at
  BEFORE UPDATE ON public.integration_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER integration_connections_set_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.integration_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_providers_read ON public.integration_providers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY integration_providers_service_all ON public.integration_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Connection rows contain encrypted credentials. They are intentionally not
-- exposed to authenticated PostgREST clients; tenant-scoped server APIs mediate
-- all reads and writes and return explicit token-free DTOs.
CREATE POLICY integration_connections_service_all ON public.integration_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY integration_logs_service_all ON public.integration_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.integration_providers (name, slug, logo, is_active)
VALUES
  ('QuickBooks Online', 'quickbooks', '/integrations/quickbooks.svg', true),
  ('Xero', 'xero', '/integrations/xero.svg', false),
  ('Zoho Books', 'zoho', '/integrations/zoho.svg', false),
  ('Sage', 'sage', '/integrations/sage.svg', false),
  ('Odoo', 'odoo', '/integrations/odoo.svg', false)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  logo = EXCLUDED.logo;
