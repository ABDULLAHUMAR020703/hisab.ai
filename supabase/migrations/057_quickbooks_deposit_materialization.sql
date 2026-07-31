-- QuickBooks Undeposited Funds and grouped bank-deposit materialization.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS deposit_account_id UUID,
  ADD COLUMN IF NOT EXISTS deposited_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'UNDEPOSITED',
  ADD CONSTRAINT payments_company_deposit_account_fkey FOREIGN KEY (company_id,deposit_account_id)
    REFERENCES public.chart_of_accounts(company_id,id) ON DELETE SET NULL,
  ADD CONSTRAINT payments_deposited_amount_chk CHECK (deposited_amount>=0 AND deposited_amount<=amount),
  ADD CONSTRAINT payments_deposit_status_chk CHECK (deposit_status IN ('UNDEPOSITED','PARTIAL','DEPOSITED'));

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS external_document_no TEXT,
  ADD COLUMN IF NOT EXISTS external_account_source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_company_id_id_key UNIQUE(company_id,id);
ALTER TABLE public.bank_reconciliations ADD CONSTRAINT bank_reconciliations_company_id_id_key UNIQUE(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_active_ledger_account_uniq ON public.bank_accounts(company_id,account_id) WHERE account_id IS NOT NULL AND deleted_at IS NULL;

-- Older deposit materialization used the archive UUID as source_id. Restore the
-- immutable QuickBooks ID before enforcing idempotency so upgrades cannot create
-- a second bank transaction for an already imported deposit.
UPDATE public.bank_transactions transaction SET source_id=record.source_id
FROM public.quickbooks_migration_records record
WHERE record.company_id=transaction.company_id AND record.entity_type='Deposit' AND record.local_table='bank_transactions' AND record.local_id=transaction.id
  AND transaction.source_type='QUICKBOOKS_DEPOSIT' AND transaction.source_id IS DISTINCT FROM record.source_id;

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_external_source_uniq
  ON public.bank_transactions(company_id,source_type,source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE public.deposit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL,
  payment_id UUID,
  account_id UUID,
  amount NUMERIC(18,4) NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate NUMERIC(18,8),
  source_deposit_id TEXT NOT NULL,
  source_line_key TEXT NOT NULL,
  source_transaction_type TEXT,
  source_transaction_id TEXT,
  source_account_id TEXT,
  source_entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_allocations_amount_chk CHECK (amount<>0),
  CONSTRAINT deposit_allocations_rate_chk CHECK (exchange_rate IS NULL OR exchange_rate>0),
  CONSTRAINT deposit_allocations_company_transaction_fkey FOREIGN KEY(company_id,bank_transaction_id) REFERENCES public.bank_transactions(company_id,id) ON DELETE CASCADE,
  CONSTRAINT deposit_allocations_company_payment_fkey FOREIGN KEY(company_id,payment_id) REFERENCES public.payments(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT deposit_allocations_company_account_fkey FOREIGN KEY(company_id,account_id) REFERENCES public.chart_of_accounts(company_id,id) ON DELETE RESTRICT,
  UNIQUE(company_id,bank_transaction_id,source_line_key)
);
CREATE INDEX deposit_allocations_payment_idx ON public.deposit_allocations(company_id,payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX deposit_allocations_source_idx ON public.deposit_allocations(company_id,source_deposit_id,source_transaction_type,source_transaction_id);

CREATE TABLE public.deposit_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_transaction_id UUID,
  source_deposit_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_audit_company_transaction_fkey FOREIGN KEY(company_id,bank_transaction_id) REFERENCES public.bank_transactions(company_id,id) ON DELETE SET NULL
);
CREATE INDEX deposit_audit_log_source_idx ON public.deposit_audit_log(company_id,source_deposit_id,created_at DESC);

CREATE TABLE public.bank_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reconciliation_id UUID NOT NULL,
  bank_transaction_id UUID NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_reconciliation_items_company_reconciliation_fkey FOREIGN KEY(company_id,reconciliation_id) REFERENCES public.bank_reconciliations(company_id,id) ON DELETE CASCADE,
  CONSTRAINT bank_reconciliation_items_company_transaction_fkey FOREIGN KEY(company_id,bank_transaction_id) REFERENCES public.bank_transactions(company_id,id) ON DELETE RESTRICT,
  UNIQUE(company_id,bank_transaction_id),
  UNIQUE(company_id,reconciliation_id,bank_transaction_id)
);
CREATE INDEX bank_reconciliation_items_reconciliation_idx ON public.bank_reconciliation_items(company_id,reconciliation_id);

ALTER TABLE public.deposit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY deposit_allocations_tenant ON public.deposit_allocations FOR ALL TO authenticated USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY deposit_allocations_service ON public.deposit_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deposit_audit_log_tenant ON public.deposit_audit_log FOR SELECT TO authenticated USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY deposit_audit_log_service ON public.deposit_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY bank_reconciliation_items_tenant ON public.bank_reconciliation_items FOR ALL TO authenticated USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY bank_reconciliation_items_service ON public.bank_reconciliation_items FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.replace_deposit_allocations(p_company_id UUID,p_bank_transaction_id UUID,p_allocations JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE transaction_row public.bank_transactions%ROWTYPE;old_payment_ids UUID[];new_payment_ids UUID[];allocation_total NUMERIC(18,4);
BEGIN
  SELECT * INTO transaction_row FROM public.bank_transactions WHERE company_id=p_company_id AND id=p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND OR transaction_row.type<>'CREDIT' THEN RAISE EXCEPTION 'Bank deposit transaction not found'; END IF;
  SELECT array_agg(DISTINCT payment_id) FILTER(WHERE payment_id IS NOT NULL) INTO old_payment_ids FROM public.deposit_allocations WHERE company_id=p_company_id AND bank_transaction_id=p_bank_transaction_id;
  DELETE FROM public.deposit_allocations WHERE company_id=p_company_id AND bank_transaction_id=p_bank_transaction_id;
  INSERT INTO public.deposit_allocations(company_id,bank_transaction_id,payment_id,account_id,amount,currency,exchange_rate,source_deposit_id,source_line_key,source_transaction_type,source_transaction_id,source_account_id,source_entity_id,metadata)
  SELECT p_company_id,p_bank_transaction_id,item.payment_id,item.account_id,ROUND(item.amount,4),UPPER(item.currency),item.exchange_rate,item.source_deposit_id,item.source_line_key,item.source_transaction_type,item.source_transaction_id,item.source_account_id,item.source_entity_id,COALESCE(item.metadata,'{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_allocations,'[]'::jsonb)) item(payment_id UUID,account_id UUID,amount NUMERIC,currency TEXT,exchange_rate NUMERIC,source_deposit_id TEXT,source_line_key TEXT,source_transaction_type TEXT,source_transaction_id TEXT,source_account_id TEXT,source_entity_id TEXT,metadata JSONB);
  SELECT COALESCE(SUM(amount),0),array_agg(DISTINCT payment_id) FILTER(WHERE payment_id IS NOT NULL) INTO allocation_total,new_payment_ids FROM public.deposit_allocations WHERE company_id=p_company_id AND bank_transaction_id=p_bank_transaction_id;
  IF ABS(allocation_total-transaction_row.amount)>0.0001 THEN RAISE EXCEPTION 'Deposit allocations (%) do not equal bank transaction (%)',allocation_total,transaction_row.amount; END IF;
  IF EXISTS(SELECT 1 FROM public.deposit_allocations allocation JOIN public.payments payment ON payment.company_id=allocation.company_id AND payment.id=allocation.payment_id WHERE allocation.company_id=p_company_id GROUP BY payment.id,payment.amount HAVING SUM(allocation.amount)>payment.amount+0.0001) THEN RAISE EXCEPTION 'A source payment is deposited more than once'; END IF;
  UPDATE public.payments payment SET deposited_amount=COALESCE(deposited.total,0),deposit_status=CASE WHEN COALESCE(deposited.total,0)=0 THEN 'UNDEPOSITED' WHEN COALESCE(deposited.total,0)>=payment.amount THEN 'DEPOSITED' ELSE 'PARTIAL' END
  FROM (SELECT candidate.id,COALESCE(SUM(allocation.amount),0) total FROM public.payments candidate LEFT JOIN public.deposit_allocations allocation ON allocation.company_id=candidate.company_id AND allocation.payment_id=candidate.id WHERE candidate.company_id=p_company_id AND candidate.id=ANY(COALESCE(old_payment_ids,'{}'::UUID[])||COALESCE(new_payment_ids,'{}'::UUID[])) GROUP BY candidate.id) deposited
  WHERE payment.company_id=p_company_id AND payment.id=deposited.id;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_deposit_allocations(UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_deposit_allocations(UUID,UUID,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(p_company_id UUID,p_reconciliation_id UUID,p_transaction_ids UUID[] DEFAULT NULL)
RETURNS public.bank_reconciliations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reconciliation public.bank_reconciliations%ROWTYPE;bank public.bank_accounts%ROWTYPE;calculated NUMERIC(18,4);selected_ids UUID[];
BEGIN
  SELECT * INTO reconciliation FROM public.bank_reconciliations WHERE company_id=p_company_id AND id=p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank reconciliation not found'; END IF;
  SELECT * INTO bank FROM public.bank_accounts WHERE company_id=p_company_id AND id=reconciliation.bank_account_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank account not found'; END IF;
  SELECT ROUND(bank.opening_balance+COALESCE(SUM(CASE WHEN transaction.type='CREDIT' THEN transaction.amount ELSE -transaction.amount END),0),4) INTO calculated
  FROM public.bank_transactions transaction WHERE transaction.company_id=p_company_id AND transaction.bank_account_id=bank.id AND transaction.transaction_date<=reconciliation.statement_date;
  IF ABS(calculated-reconciliation.statement_balance)>0.01 THEN RAISE EXCEPTION 'Statement balance (%) does not reconcile to the transaction roll-forward (%)',reconciliation.statement_balance,calculated; END IF;
  IF COALESCE(array_length(p_transaction_ids,1),0)>0 THEN
    IF EXISTS(SELECT 1 FROM unnest(p_transaction_ids) id LEFT JOIN public.bank_transactions transaction ON transaction.company_id=p_company_id AND transaction.id=id AND transaction.bank_account_id=bank.id AND transaction.transaction_date<=reconciliation.statement_date WHERE transaction.id IS NULL) THEN RAISE EXCEPTION 'A selected transaction does not belong to this bank statement'; END IF;
    selected_ids:=p_transaction_ids;
  ELSE
    SELECT array_agg(transaction.id) INTO selected_ids FROM public.bank_transactions transaction
    WHERE transaction.company_id=p_company_id AND transaction.bank_account_id=bank.id AND transaction.transaction_date<=reconciliation.statement_date
      AND NOT EXISTS(SELECT 1 FROM public.bank_reconciliation_items item WHERE item.company_id=p_company_id AND item.bank_transaction_id=transaction.id);
  END IF;
  INSERT INTO public.bank_reconciliation_items(company_id,reconciliation_id,bank_transaction_id,amount)
  SELECT p_company_id,reconciliation.id,transaction.id,CASE WHEN transaction.type='CREDIT' THEN transaction.amount ELSE -transaction.amount END FROM public.bank_transactions transaction WHERE transaction.company_id=p_company_id AND transaction.id=ANY(COALESCE(selected_ids,'{}'::UUID[]))
  ON CONFLICT(company_id,reconciliation_id,bank_transaction_id) DO NOTHING;
  UPDATE public.bank_transactions SET status='RECONCILED',reconciled_at=COALESCE(reconciled_at,now()) WHERE company_id=p_company_id AND id=ANY(COALESCE(selected_ids,'{}'::UUID[]));
  INSERT INTO public.deposit_audit_log(company_id,bank_transaction_id,source_deposit_id,action,details)
  SELECT p_company_id,transaction.id,transaction.source_id,'RECONCILED',jsonb_build_object('reconciliationId',reconciliation.id,'statementDate',reconciliation.statement_date,'statementBalance',reconciliation.statement_balance)
  FROM public.bank_transactions transaction WHERE transaction.company_id=p_company_id AND transaction.id=ANY(COALESCE(selected_ids,'{}'::UUID[])) AND transaction.source_type='QUICKBOOKS_DEPOSIT'
    AND NOT EXISTS(SELECT 1 FROM public.deposit_audit_log audit WHERE audit.company_id=p_company_id AND audit.bank_transaction_id=transaction.id AND audit.action='RECONCILED' AND audit.details->>'reconciliationId'=reconciliation.id::TEXT);
  UPDATE public.bank_reconciliations SET reconciled_balance=calculated,status='COMPLETED',completed_at=COALESCE(completed_at,now()) WHERE company_id=p_company_id AND id=reconciliation.id RETURNING * INTO reconciliation;
  RETURN reconciliation;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_bank_reconciliation(UUID,UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_bank_reconciliation(UUID,UUID,UUID[]) TO service_role;
