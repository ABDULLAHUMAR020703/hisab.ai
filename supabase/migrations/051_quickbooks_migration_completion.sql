-- Durable, lossless QuickBooks migration state. Product tables continue to own
-- accounting behavior; these tables retain source fidelity and orchestration state.

CREATE TABLE IF NOT EXISTS public.quickbooks_migration_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sync_token TEXT,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  is_active BOOLEAN,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  source_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  relationships JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  currency_code TEXT,
  exchange_rate NUMERIC(28,12),
  local_table TEXT,
  local_id UUID,
  extraction_partition TEXT,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id, entity_type, source_id)
);

CREATE TABLE IF NOT EXISTS public.quickbooks_migration_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  extraction_mode TEXT NOT NULL DEFAULT 'full' CHECK (extraction_mode IN ('full','partitioned','cdc','webhook')),
  partition_start TIMESTAMPTZ,
  partition_end TIMESTAMPTZ,
  next_start_position BIGINT NOT NULL DEFAULT 1,
  last_source_updated_at TIMESTAMPTZ,
  last_webhook_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','completed','failed')),
  extracted_count BIGINT NOT NULL DEFAULT 0,
  imported_count BIGINT NOT NULL DEFAULT 0,
  warning_count BIGINT NOT NULL DEFAULT 0,
  failure_count BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id, resource_key)
);

CREATE TABLE IF NOT EXISTS public.quickbooks_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  realm_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','ignored')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, realm_id, entity_type, entity_id, operation)
);

CREATE TABLE IF NOT EXISTS public.quickbooks_migration_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  source_id TEXT,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quickbooks_migration_local_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  local_table TEXT NOT NULL,
  local_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id, entity_type, source_id, local_table, local_id)
);

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS source_checkpoint JSONB,
  ADD COLUMN IF NOT EXISTS source_realm_id TEXT;

-- Attachment bytes are private and retained independently from expiring Intuit URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('quickbooks-migration', 'quickbooks-migration', false, 104857600)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE INDEX IF NOT EXISTS quickbooks_migration_records_lookup_idx
  ON public.quickbooks_migration_records(company_id, realm_id, entity_type, source_updated_at);
CREATE INDEX IF NOT EXISTS quickbooks_migration_records_local_idx
  ON public.quickbooks_migration_records(company_id, local_table, local_id);
CREATE INDEX IF NOT EXISTS quickbooks_migration_checkpoints_status_idx
  ON public.quickbooks_migration_checkpoints(company_id, status, updated_at);
CREATE INDEX IF NOT EXISTS quickbooks_webhook_events_pending_idx
  ON public.quickbooks_webhook_events(status, event_time) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS quickbooks_migration_warnings_resource_idx
  ON public.quickbooks_migration_warnings(company_id, resource_key, created_at DESC);
CREATE INDEX IF NOT EXISTS quickbooks_migration_local_links_source_idx
  ON public.quickbooks_migration_local_links(company_id, realm_id, entity_type, source_id);

ALTER TABLE public.quickbooks_migration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_migration_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_migration_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_migration_local_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY quickbooks_migration_records_tenant ON public.quickbooks_migration_records FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_migration_records_service ON public.quickbooks_migration_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY quickbooks_migration_checkpoints_tenant ON public.quickbooks_migration_checkpoints FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_migration_checkpoints_service ON public.quickbooks_migration_checkpoints FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY quickbooks_migration_warnings_tenant ON public.quickbooks_migration_warnings FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_migration_warnings_service ON public.quickbooks_migration_warnings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY quickbooks_webhook_events_service ON public.quickbooks_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY quickbooks_migration_local_links_tenant ON public.quickbooks_migration_local_links FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_migration_local_links_service ON public.quickbooks_migration_local_links FOR ALL TO service_role USING (true) WITH CHECK (true);
