-- Phase B prep: ZATCA audit, sandbox runs, optional XML archive metadata
-- Depends on: 003_companies, 008_invoices
-- Note: zatca_credentials + zatca_onboarding_requests already exist in 003_companies (Phase A)

CREATE TABLE public.zatca_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  message TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT,
  company_name TEXT,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zatca_audit_logs_company_created_idx
  ON public.zatca_audit_logs (company_id, created_at DESC);

CREATE INDEX zatca_audit_logs_invoice_id_idx
  ON public.zatca_audit_logs (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX zatca_audit_logs_company_action_idx
  ON public.zatca_audit_logs (company_id, action, created_at DESC);

CREATE TABLE public.zatca_sandbox_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  scenario TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  steps JSONB NOT NULL,
  error TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zatca_sandbox_test_runs_company_created_idx
  ON public.zatca_sandbox_test_runs (company_id, created_at DESC);

-- Optional archive metadata for large signed/cleared XML (Storage path; invoice.signed_xml retained for parity)
CREATE TABLE public.zatca_xml_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  archive_type TEXT NOT NULL CHECK (archive_type IN ('SIGNED', 'CLEARED', 'SUBMITTED')),
  storage_bucket TEXT NOT NULL DEFAULT 'company-files',
  storage_path TEXT NOT NULL,
  content_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, archive_type)
);

CREATE INDEX zatca_xml_archive_company_id_idx ON public.zatca_xml_archive (company_id);

-- Submission/API log split from audit (future API tracing; metadata only in Phase B schema)
CREATE TABLE public.zatca_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  environment public.zatca_environment NOT NULL,
  endpoint TEXT NOT NULL,
  http_method TEXT NOT NULL DEFAULT 'POST',
  request_id TEXT,
  response_code TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  duration_ms INT,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zatca_api_logs_company_created_idx
  ON public.zatca_api_logs (company_id, created_at DESC);

-- RLS
ALTER TABLE public.zatca_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_sandbox_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_xml_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_api_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY zatca_audit_logs_select ON public.zatca_audit_logs FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT', 'AUDITOR']::public.company_role[])
  );

CREATE POLICY zatca_audit_logs_service ON public.zatca_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY zatca_sandbox_test_runs_select ON public.zatca_sandbox_test_runs FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[])
  );

CREATE POLICY zatca_sandbox_test_runs_service ON public.zatca_sandbox_test_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY zatca_xml_archive_tenant ON public.zatca_xml_archive FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[])
  )
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY zatca_xml_archive_service ON public.zatca_xml_archive FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY zatca_api_logs_select ON public.zatca_api_logs FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(company_id, ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT', 'AUDITOR']::public.company_role[])
  );

CREATE POLICY zatca_api_logs_service ON public.zatca_api_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add FK from zatca_audit_logs to invoices (008 must run first — this migration runs after 008)
COMMENT ON TABLE public.zatca_credentials IS 'Phase A — onboarding CSID, encrypted keys/certs; Prisma ZatcaCredential parity';
COMMENT ON TABLE public.invoices IS 'Full ZATCA invoice pipeline fields preserved from Prisma Invoice model';
