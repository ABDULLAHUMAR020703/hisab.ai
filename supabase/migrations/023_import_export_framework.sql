-- Import/Export Framework: jobs, errors, mapping templates
-- Depends on: 004_auth_profiles, 003_companies

CREATE TABLE public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  module_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('csv', 'xlsx')),

  duplicate_strategy TEXT CHECK (duplicate_strategy IN ('skip', 'update', 'create')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'parsing', 'mapping', 'validating', 'processing',
    'completed', 'failed', 'cancelled'
  )),

  total_rows INT NOT NULL DEFAULT 0,
  imported_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,

  valid_rows INT,
  invalid_rows INT,
  warning_count INT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INT,

  mapping_snapshot JSONB,
  validation_summary JSONB,
  error_summary JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.import_job_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  field_key TEXT,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.import_mapping_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  column_mapping JSONB NOT NULL,
  header_fingerprint TEXT,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, module_key, name)
);

CREATE INDEX import_jobs_company_history_idx
  ON public.import_jobs (company_id, created_at DESC)
  WHERE status IN ('completed', 'failed', 'cancelled');

CREATE INDEX import_jobs_company_active_idx
  ON public.import_jobs (company_id, status)
  WHERE status IN ('pending', 'parsing', 'mapping', 'validating', 'processing');

CREATE INDEX import_jobs_company_module_idx
  ON public.import_jobs (company_id, module_key, created_at DESC);

CREATE INDEX import_job_errors_job_idx ON public.import_job_errors (job_id);
CREATE INDEX mapping_templates_company_module_idx
  ON public.import_mapping_templates (company_id, module_key);

CREATE TRIGGER import_jobs_set_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER import_mapping_templates_set_updated_at
  BEFORE UPDATE ON public.import_mapping_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_job_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_mapping_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_jobs_tenant ON public.import_jobs FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY import_jobs_service ON public.import_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY import_job_errors_tenant ON public.import_job_errors FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY import_job_errors_service ON public.import_job_errors FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY import_mapping_templates_tenant ON public.import_mapping_templates FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY import_mapping_templates_service ON public.import_mapping_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);
