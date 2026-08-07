-- Scalable evidence aggregation for QuickBooks multi-currency certification.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);
ALTER TABLE public.sales_receipts ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);
ALTER TABLE public.vendor_credits ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8),ADD COLUMN IF NOT EXISTS base_total NUMERIC(18,4);

CREATE OR REPLACE FUNCTION public.certification_fx_ledger_by_source(
  p_company_id UUID,p_from TIMESTAMPTZ,p_to TIMESTAMPTZ
) RETURNS TABLE(
  source_id UUID,source_type TEXT,currency TEXT,base_currency TEXT,
  transaction_debit NUMERIC,transaction_credit NUMERIC,base_debit NUMERIC,base_credit NUMERIC,
  minimum_rate NUMERIC,maximum_rate NUMERIC,invalid_rate_count BIGINT,line_count BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT entry.source_id,entry.source_type::TEXT,UPPER(entry.currency),UPPER(COALESCE(entry.base_currency,company.currency)),
    SUM(entry.debit),SUM(entry.credit),SUM(COALESCE(entry.base_debit,entry.debit)),SUM(COALESCE(entry.base_credit,entry.credit)),
    MIN(entry.exchange_rate),MAX(entry.exchange_rate),
    COUNT(*) FILTER(WHERE UPPER(entry.currency)<>UPPER(company.currency) AND (entry.exchange_rate IS NULL OR entry.exchange_rate<=0)),COUNT(*)
  FROM public.ledger_entries entry JOIN public.companies company ON company.id=entry.company_id
  WHERE entry.company_id=p_company_id AND entry.entry_date>=p_from AND entry.entry_date<=p_to AND entry.source_id IS NOT NULL
  GROUP BY entry.source_id,entry.source_type,UPPER(entry.currency),UPPER(COALESCE(entry.base_currency,company.currency));
$$;

CREATE OR REPLACE FUNCTION public.certification_fx_account_balances(
  p_company_id UUID,p_from TIMESTAMPTZ,p_to TIMESTAMPTZ
) RETURNS TABLE(
  account_id UUID,account_name TEXT,normal_balance TEXT,currency TEXT,base_currency TEXT,
  transaction_debit NUMERIC,transaction_credit NUMERIC,base_debit NUMERIC,base_credit NUMERIC,line_count BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account.id,COALESCE(account.full_name,account.name),account.normal_balance::TEXT,UPPER(entry.currency),UPPER(COALESCE(entry.base_currency,company.currency)),
    SUM(entry.debit),SUM(entry.credit),SUM(COALESCE(entry.base_debit,entry.debit)),SUM(COALESCE(entry.base_credit,entry.credit)),COUNT(*)
  FROM public.ledger_entries entry JOIN public.chart_of_accounts account ON account.id=entry.account_id JOIN public.companies company ON company.id=entry.company_id
  WHERE entry.company_id=p_company_id AND entry.entry_date>=p_from AND entry.entry_date<=p_to
  GROUP BY account.id,account.full_name,account.name,account.normal_balance,UPPER(entry.currency),UPPER(COALESCE(entry.base_currency,company.currency));
$$;

REVOKE ALL ON FUNCTION public.certification_fx_ledger_by_source(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.certification_fx_account_balances(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certification_fx_ledger_by_source(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.certification_fx_account_balances(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;

CREATE INDEX IF NOT EXISTS quickbooks_migration_records_fx_idx
  ON public.quickbooks_migration_records(company_id,realm_id,entity_type,currency_code,source_id);
CREATE INDEX IF NOT EXISTS fx_revaluation_lines_certification_idx
  ON public.fx_revaluation_lines(company_id,currency,revaluation_id,account_id);
