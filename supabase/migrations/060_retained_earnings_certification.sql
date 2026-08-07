-- Period-level retained-earnings certification evidence and drill-down.
CREATE TABLE public.quickbooks_retained_earnings_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.quickbooks_certification_runs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  period_label TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  quickbooks_evidence JSONB NOT NULL,
  hisab_evidence JSONB NOT NULL,
  fiscal_close_required BOOLEAN NOT NULL DEFAULT false,
  fiscal_close_proven BOOLEAN NOT NULL DEFAULT false,
  cutoff_basis TEXT,
  status TEXT NOT NULL CHECK(status IN ('MATCHED','FAILED')),
  differences JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id,period_key)
);
CREATE INDEX quickbooks_retained_earnings_company_period_idx ON public.quickbooks_retained_earnings_periods(company_id,period_start,period_end);
ALTER TABLE public.quickbooks_retained_earnings_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_retained_earnings_tenant ON public.quickbooks_retained_earnings_periods FOR SELECT TO authenticated USING(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_retained_earnings_service ON public.quickbooks_retained_earnings_periods FOR ALL TO service_role USING(true) WITH CHECK(true);
