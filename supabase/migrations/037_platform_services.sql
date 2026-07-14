-- ERP platform services (additive — extends 031 documents/sequences without breaking them)

-- ===================== DOCUMENT MANAGEMENT =====================

CREATE TYPE public.document_status AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

CREATE TABLE IF NOT EXISTS public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.document_categories(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.document_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  UNIQUE (company_id, name)
);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.document_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status public.document_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_policy_id UUID,
  ADD COLUMN IF NOT EXISTS preview_path TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

CREATE TABLE IF NOT EXISTS public.document_tag_assignments (
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.document_tags(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.document_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  target_document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'RELATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, target_document_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS public.document_ocr_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  provider TEXT,
  raw_text TEXT,
  fields JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC(5, 4),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  retain_days INT NOT NULL DEFAULT 2555,
  action_on_expiry TEXT NOT NULL DEFAULT 'ARCHIVE',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_retention_policy_id_fkey;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_retention_policy_id_fkey
  FOREIGN KEY (retention_policy_id) REFERENCES public.document_retention_policies(id) ON DELETE SET NULL;

-- ===================== NOTIFICATION CENTER =====================

CREATE TYPE public.notification_channel AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE public.notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

CREATE TABLE IF NOT EXISTS public.platform_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel public.notification_channel NOT NULL DEFAULT 'IN_APP',
  category TEXT NOT NULL DEFAULT 'SYSTEM',
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  status public.notification_status NOT NULL DEFAULT 'PENDING',
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  source_type TEXT,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  channel public.notification_channel NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, user_id, category, channel)
);

CREATE TABLE IF NOT EXISTS public.notification_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.platform_notifications(id) ON DELETE CASCADE,
  channel public.notification_channel NOT NULL,
  provider TEXT,
  status TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== BACKGROUND JOBS =====================

CREATE TYPE public.job_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD', 'CANCELLED');
CREATE TYPE public.job_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

CREATE TABLE IF NOT EXISTS public.job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status public.job_status NOT NULL DEFAULT 'PENDING',
  priority public.job_priority NOT NULL DEFAULT 'NORMAL',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  progress INT NOT NULL DEFAULT 0,
  progress_message TEXT,
  last_error TEXT,
  cron_expression TEXT,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.job_queue(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  status public.job_status NOT NULL,
  payload JSONB,
  result JSONB,
  error TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.job_queue(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  error TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ
);

-- ===================== AUTOMATION ENGINE =====================

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  actions_executed JSONB NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== WEBHOOKS =====================

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'OUTGOING',
  url TEXT NOT NULL,
  secret_hash TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  response_status INT,
  response_body TEXT,
  signature TEXT,
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== API MANAGEMENT =====================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT,
  duration_ms INT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== INTEGRATIONS =====================

CREATE TABLE IF NOT EXISTS public.integration_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL DEFAULT 'REST',
  config_schema JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.integration_connectors(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- ===================== FEATURE FLAGS =====================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  default_enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percent INT NOT NULL DEFAULT 0,
  is_experimental BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feature_flag_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id UUID NOT NULL REFERENCES public.feature_flags(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id UUID,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== LOCALIZATION =====================

CREATE TABLE IF NOT EXISTS public.locale_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'en-SA',
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
  number_format TEXT NOT NULL DEFAULT '1,234.56',
  currency_display TEXT NOT NULL DEFAULT 'symbol',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS public.translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'app',
  locale TEXT NOT NULL,
  message_key TEXT NOT NULL,
  message_value TEXT NOT NULL,
  UNIQUE (namespace, locale, message_key)
);

-- ===================== NUMBERING ENGINE =====================

CREATE TABLE IF NOT EXISTS public.numbering_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  padding INT NOT NULL DEFAULT 5,
  next_number BIGINT NOT NULL DEFAULT 1,
  include_fiscal_year BOOLEAN NOT NULL DEFAULT false,
  branch_code TEXT,
  reset_on_fiscal_year BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, series_key, branch_code)
);

-- ===================== SEARCH =====================

CREATE TABLE IF NOT EXISTS public.search_recent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  entity_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS platform_notifications_user_idx ON public.platform_notifications (company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_queue_pending_idx ON public.job_queue (status, scheduled_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS automation_rules_event_idx ON public.automation_rules (company_id, event_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx ON public.webhook_deliveries (status, next_retry_at);
CREATE INDEX IF NOT EXISTS api_usage_logs_company_idx ON public.api_usage_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_status_idx ON public.documents (company_id, status);

-- RLS
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ocr_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locale_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.numbering_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_recent ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_categories_tenant ON public.document_categories FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_tags_tenant ON public.document_tags FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_versions_tenant ON public.document_versions FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_tag_assignments_tenant ON public.document_tag_assignments FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_comments_tenant ON public.document_comments FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_relationships_tenant ON public.document_relationships FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_ocr_metadata_tenant ON public.document_ocr_metadata FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY document_retention_policies_tenant ON public.document_retention_policies FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY platform_notifications_tenant ON public.platform_notifications FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY notification_preferences_tenant ON public.notification_preferences FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY notification_delivery_log_tenant ON public.notification_delivery_log FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY job_queue_tenant ON public.job_queue FOR ALL USING (company_id IS NULL OR company_id IN (SELECT public.user_company_ids()));
CREATE POLICY job_history_tenant ON public.job_history FOR ALL USING (company_id IS NULL OR company_id IN (SELECT public.user_company_ids()));
CREATE POLICY dead_letter_queue_tenant ON public.dead_letter_queue FOR ALL USING (company_id IS NULL OR company_id IN (SELECT public.user_company_ids()));
CREATE POLICY automation_rules_tenant ON public.automation_rules FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY automation_runs_tenant ON public.automation_runs FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY webhook_endpoints_tenant ON public.webhook_endpoints FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY webhook_deliveries_tenant ON public.webhook_deliveries FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY api_keys_tenant ON public.api_keys FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY api_usage_logs_tenant ON public.api_usage_logs FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY integration_connections_tenant ON public.integration_connections FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY feature_flag_overrides_tenant ON public.feature_flag_overrides FOR ALL USING (company_id IS NULL OR company_id IN (SELECT public.user_company_ids()));
CREATE POLICY locale_settings_tenant ON public.locale_settings FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY numbering_series_tenant ON public.numbering_series FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY search_recent_tenant ON public.search_recent FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- Connector catalog (system-level, no company)
INSERT INTO public.integration_connectors (provider_key, name, connector_type, config_schema) VALUES
  ('quickbooks', 'QuickBooks', 'REST', '{"fields":["clientId","clientSecret","realmId"]}'),
  ('xero', 'Xero', 'REST', '{"fields":["clientId","clientSecret","tenantId"]}'),
  ('sap', 'SAP', 'REST', '{"fields":["host","username","password"]}'),
  ('stripe', 'Stripe', 'REST', '{"fields":["secretKey","webhookSecret"]}'),
  ('paypal', 'PayPal', 'REST', '{"fields":["clientId","clientSecret","mode"]}'),
  ('twilio', 'Twilio', 'REST', '{"fields":["accountSid","authToken","fromNumber"]}'),
  ('resend', 'Resend', 'REST', '{"fields":["apiKey","fromEmail"]}'),
  ('google', 'Google', 'REST', '{"fields":["clientId","clientSecret","refreshToken"]}'),
  ('microsoft', 'Microsoft', 'REST', '{"fields":["clientId","clientSecret","tenantId"]}'),
  ('graphql', 'Generic GraphQL', 'GRAPHQL', '{"fields":["endpoint","headers"]}'),
  ('rest', 'Generic REST', 'REST', '{"fields":["baseUrl","apiKey"]}')
ON CONFLICT (provider_key) DO NOTHING;

-- Feature flag seeds (platform defaults, overridable per company)
INSERT INTO public.feature_flags (flag_key, name, description, default_enabled, is_experimental) VALUES
  ('enterprise_reporting', 'Enterprise Reporting', 'Advanced reporting engine', true, false),
  ('workflow_engine', 'Workflow Engine', 'Configurable approvals', true, false),
  ('automation_engine', 'Automation Engine', 'Event-driven automations', false, true),
  ('global_search', 'Global Search', 'Cross-entity search', true, false),
  ('api_access', 'API Access', 'External API keys', false, true)
ON CONFLICT (flag_key) DO NOTHING;
