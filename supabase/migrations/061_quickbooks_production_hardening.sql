-- Final QuickBooks migration production hardening.

-- Synchronization payloads contain tenant accounting data and must never rely
-- solely on API filters for isolation.
ALTER TABLE public.accounting_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sync_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_sync_settings_tenant ON public.accounting_sync_settings;
DROP POLICY IF EXISTS accounting_sync_settings_service ON public.accounting_sync_settings;
DROP POLICY IF EXISTS accounting_sync_runs_tenant ON public.accounting_sync_runs;
DROP POLICY IF EXISTS accounting_sync_runs_service ON public.accounting_sync_runs;
DROP POLICY IF EXISTS accounting_sync_changes_tenant ON public.accounting_sync_changes;
DROP POLICY IF EXISTS accounting_sync_changes_service ON public.accounting_sync_changes;

CREATE POLICY accounting_sync_settings_tenant ON public.accounting_sync_settings
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY accounting_sync_settings_service ON public.accounting_sync_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY accounting_sync_runs_tenant ON public.accounting_sync_runs
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY accounting_sync_runs_service ON public.accounting_sync_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY accounting_sync_changes_tenant ON public.accounting_sync_changes
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY accounting_sync_changes_service ON public.accounting_sync_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS accounting_sync_changes_run_status_idx
  ON public.accounting_sync_changes(company_id,run_id,status);
CREATE INDEX IF NOT EXISTS accounting_sync_changes_detected_idx
  ON public.accounting_sync_changes(company_id,provider,status,detected_at DESC);
CREATE INDEX IF NOT EXISTS quickbooks_webhook_events_processing_idx
  ON public.quickbooks_webhook_events(realm_id,status,event_time,id);

CREATE TABLE IF NOT EXISTS public.quickbooks_extraction_staging (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,realm_id,resource_key,source_id)
);
ALTER TABLE public.quickbooks_extraction_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_extraction_staging_service ON public.quickbooks_extraction_staging
  FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX IF NOT EXISTS quickbooks_extraction_staging_resource_idx
  ON public.quickbooks_extraction_staging(company_id,realm_id,resource_key,created_at);

-- Native, non-posting opening subledger documents are idempotent by source.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_cutoff_opening_legacy_idx
  ON public.invoices(company_id,legacy_id)
  WHERE legacy_id LIKE 'quickbooks-cutoff:%';
CREATE UNIQUE INDEX IF NOT EXISTS bills_cutoff_opening_legacy_idx
  ON public.bills(company_id,legacy_id)
  WHERE legacy_id LIKE 'quickbooks-cutoff:%';
CREATE UNIQUE INDEX IF NOT EXISTS payments_cutoff_opening_legacy_idx
  ON public.payments(company_id,legacy_id)
  WHERE legacy_id LIKE 'quickbooks-cutoff:%';
CREATE UNIQUE INDEX IF NOT EXISTS vendor_credits_cutoff_opening_legacy_idx
  ON public.vendor_credits(company_id,legacy_id)
  WHERE legacy_id LIKE 'quickbooks-cutoff:%';

CREATE INDEX IF NOT EXISTS invoices_open_ar_aging_idx
  ON public.invoices(company_id,customer_id,due_date)
  WHERE deleted_at IS NULL AND balance>0;
CREATE INDEX IF NOT EXISTS bills_open_ap_aging_idx
  ON public.bills(company_id,vendor_id,due_date)
  WHERE deleted_at IS NULL AND balance>0;
