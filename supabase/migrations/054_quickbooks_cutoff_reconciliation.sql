CREATE TABLE IF NOT EXISTS public.quickbooks_cutoff_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('FULL_HISTORY','OPENING_BALANCE_ONLY','HYBRID')),
  cutoff_date DATE NOT NULL,
  opening_as_of_date DATE NOT NULL,
  reconciliation_date DATE NOT NULL,
  accounting_basis TEXT NOT NULL DEFAULT 'Accrual' CHECK(accounting_basis IN ('Cash','Accrual')),
  home_currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','GENERATING','RECONCILING','PASSED','FAILED')),
  source_hash TEXT,
  opening_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  result JSONB,
  last_error TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id,realm_id,mode,cutoff_date,reconciliation_date)
);

CREATE TABLE IF NOT EXISTS public.quickbooks_opening_balance_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID NOT NULL REFERENCES public.quickbooks_cutoff_reconciliations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  balance_type TEXT NOT NULL CHECK(balance_type IN ('GENERAL_LEDGER','ACCOUNTS_RECEIVABLE','ACCOUNTS_PAYABLE','INVENTORY','BANK','TAX','EQUITY','FOREIGN_CURRENCY')),
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_id TEXT,
  local_table TEXT,
  local_id UUID,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  currency TEXT NOT NULL,
  debit NUMERIC(24,6) NOT NULL DEFAULT 0,
  credit NUMERIC(24,6) NOT NULL DEFAULT 0,
  quantity NUMERIC(24,6) NOT NULL DEFAULT 0,
  value NUMERIC(24,6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reconciliation_id,balance_type,source_key,currency)
);

CREATE INDEX IF NOT EXISTS quickbooks_cutoff_company_idx ON public.quickbooks_cutoff_reconciliations(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS quickbooks_opening_details_company_type_idx ON public.quickbooks_opening_balance_details(company_id,balance_type,local_id);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_cutoff_opening_key_idx
  ON public.journal_entries(company_id,legacy_id)
  WHERE legacy_id LIKE 'quickbooks-cutoff:%' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_cutoff_opening_key_idx
  ON public.stock_movements(company_id,source_type,source_id)
  WHERE source_type='QUICKBOOKS_CUTOFF_OPENING';
ALTER TABLE public.quickbooks_cutoff_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_opening_balance_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_cutoff_tenant ON public.quickbooks_cutoff_reconciliations FOR ALL TO authenticated USING(company_id IN (SELECT public.user_company_ids())) WITH CHECK(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_cutoff_service ON public.quickbooks_cutoff_reconciliations FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY quickbooks_opening_details_tenant ON public.quickbooks_opening_balance_details FOR ALL TO authenticated USING(company_id IN (SELECT public.user_company_ids())) WITH CHECK(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_opening_details_service ON public.quickbooks_opening_balance_details FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION public.aggregate_cutoff_ledger_movement(
  p_company_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_excluded_opening_journal_id UUID DEFAULT NULL
) RETURNS TABLE(account_id UUID,total_debit NUMERIC,total_credit NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account.id,COALESCE(SUM(entry.debit),0),COALESCE(SUM(entry.credit),0)
  FROM public.chart_of_accounts account
  LEFT JOIN public.ledger_entries entry ON entry.account_id=account.id
    AND entry.company_id=p_company_id
    AND entry.entry_date>=p_from AND entry.entry_date<=p_to
    AND (p_excluded_opening_journal_id IS NULL OR NOT (
      entry.source_type='OPENING_BALANCE' AND entry.source_id=p_excluded_opening_journal_id
    ))
  WHERE account.company_id=p_company_id AND account.deleted_at IS NULL
    AND COALESCE(account.sub_type,'')<>'Header'
  GROUP BY account.id;
$$;
REVOKE ALL ON FUNCTION public.aggregate_cutoff_ledger_movement(UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aggregate_cutoff_ledger_movement(UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO service_role;
