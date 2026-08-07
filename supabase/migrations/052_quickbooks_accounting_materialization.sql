-- Accounting-aware QuickBooks materialization state. Extraction remains owned by 051.
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'DEPOSIT';
CREATE TABLE IF NOT EXISTS public.quickbooks_materialization_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  local_table TEXT NOT NULL,
  local_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posting','completed','failed','conflict','manual_required')),
  attempt_count INT NOT NULL DEFAULT 0,
  ledger_entry_count INT NOT NULL DEFAULT 0,
  inventory_movement_count INT NOT NULL DEFAULT 0,
  relationship_count INT NOT NULL DEFAULT 0,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, realm_id, entity_type, source_id, module_key)
);

CREATE INDEX IF NOT EXISTS quickbooks_materialization_status_idx
  ON public.quickbooks_materialization_runs(company_id, status, updated_at);

ALTER TABLE public.quickbooks_materialization_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_materialization_tenant ON public.quickbooks_materialization_runs FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY quickbooks_materialization_service ON public.quickbooks_materialization_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.post_source_document_lines(
  p_company_id UUID,
  p_source_type public.ledger_source_type,
  p_source_id UUID,
  p_lines JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sequence BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE company_id=p_company_id AND source_type=p_source_type AND source_id=p_source_id) THEN
    SELECT COALESCE(MAX(posting_sequence),0) INTO v_sequence FROM public.ledger_entries WHERE company_id=p_company_id AND source_type=p_source_type AND source_id=p_source_id;
    RETURN v_sequence;
  END IF;
  v_sequence := public.next_posting_sequence(p_company_id);
  INSERT INTO public.ledger_entries (
    company_id,account_id,source_type,source_id,entry_date,description,debit,credit,currency,
    base_currency,base_debit,base_credit,exchange_rate,reporting_currency,reporting_debit,
    reporting_credit,cost_center_id,posting_sequence
  )
  SELECT p_company_id,x.account_id,p_source_type,p_source_id,x.entry_date,x.description,x.debit,x.credit,x.currency,
    x.base_currency,x.base_debit,x.base_credit,x.exchange_rate,x.reporting_currency,x.reporting_debit,
    x.reporting_credit,x.cost_center_id,v_sequence
  FROM jsonb_to_recordset(p_lines) AS x(
    account_id UUID,entry_date TIMESTAMPTZ,description TEXT,debit NUMERIC,credit NUMERIC,currency TEXT,
    base_currency TEXT,base_debit NUMERIC,base_credit NUMERIC,exchange_rate NUMERIC,reporting_currency TEXT,
    reporting_debit NUMERIC,reporting_credit NUMERIC,cost_center_id UUID
  );
  UPDATE public.chart_of_accounts account
  SET balance=account.balance+totals.net,updated_at=now()
  FROM (
    SELECT x.account_id,SUM(COALESCE(x.base_debit,x.debit,0)-COALESCE(x.base_credit,x.credit,0)) AS net
    FROM jsonb_to_recordset(p_lines) AS x(account_id UUID,debit NUMERIC,credit NUMERIC,base_debit NUMERIC,base_credit NUMERIC)
    GROUP BY x.account_id
  ) totals
  WHERE account.id=totals.account_id AND account.company_id=p_company_id;
  RETURN v_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.post_source_document_lines(UUID,public.ledger_source_type,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_source_document_lines(UUID,public.ledger_source_type,UUID,JSONB) TO service_role;
