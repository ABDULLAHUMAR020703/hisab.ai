CREATE TABLE IF NOT EXISTS public.quickbooks_certification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','CERTIFIED','CERTIFIED_WITH_WARNINGS','FAILED')),
  parameters JSONB NOT NULL,
  report JSONB,
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quickbooks_certification_runs_company_idx ON public.quickbooks_certification_runs(company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.quickbooks_certification_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.quickbooks_certification_runs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('MATCHED','WARNING','FAILED','UNAVAILABLE')),
  quickbooks_hash TEXT,
  hisab_hash TEXT,
  quickbooks_snapshot JSONB,
  hisab_snapshot JSONB,
  comparison JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id,report_key)
);
CREATE INDEX IF NOT EXISTS quickbooks_certification_sections_run_idx ON public.quickbooks_certification_sections(run_id,report_key);

ALTER TABLE public.quickbooks_certification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_certification_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_certification_runs_tenant ON public.quickbooks_certification_runs FOR ALL TO authenticated USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_certification_runs_service ON public.quickbooks_certification_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY quickbooks_certification_sections_tenant ON public.quickbooks_certification_sections FOR ALL TO authenticated USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_certification_sections_service ON public.quickbooks_certification_sections FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.aggregate_ledger_balances_for_report(
  p_company_id UUID,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(
  account_id UUID,
  account_no TEXT,
  account_name TEXT,
  canonical_type TEXT,
  normal_balance TEXT,
  total_debit NUMERIC,
  total_credit NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account.id,account.account_no,COALESCE(account.full_name,account.name),account.canonical_type::TEXT,account.normal_balance::TEXT,
    COALESCE(SUM(entry.debit),0),COALESCE(SUM(entry.credit),0)
  FROM public.chart_of_accounts account
  LEFT JOIN public.ledger_entries entry ON entry.account_id=account.id AND entry.company_id=p_company_id
    AND (p_from IS NULL OR entry.entry_date>=p_from) AND (p_to IS NULL OR entry.entry_date<=p_to)
  WHERE account.company_id=p_company_id AND account.deleted_at IS NULL AND COALESCE(account.sub_type,'')<>'Header'
  GROUP BY account.id,account.account_no,account.full_name,account.name,account.canonical_type,account.normal_balance
  ORDER BY account.account_no;
$$;
REVOKE ALL ON FUNCTION public.aggregate_ledger_balances_for_report(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aggregate_ledger_balances_for_report(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
