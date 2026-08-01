-- Authoritative many-to-many payment application ledger.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_company_id_id_key') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_company_id_id_key UNIQUE (company_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_company_id_id_key') THEN
    ALTER TABLE public.customers ADD CONSTRAINT customers_company_id_id_key UNIQUE (company_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.vendors'::regclass AND conname='vendors_company_id_id_key') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_company_id_id_key UNIQUE (company_id,id);
  END IF;
END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS vendor_id UUID,
  ADD COLUMN IF NOT EXISTS applied_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_applied_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unapplied_amount NUMERIC(18,4) NOT NULL DEFAULT 0;

ALTER TABLE public.vendor_credits
  ADD COLUMN IF NOT EXISTS applied_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance NUMERIC(18,4) NOT NULL DEFAULT 0;
UPDATE public.vendor_credits SET balance=total WHERE balance=0 AND total>0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_company_customer_fkey') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_company_customer_fkey FOREIGN KEY (company_id,customer_id)
      REFERENCES public.customers(company_id,id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_company_vendor_fkey') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_company_vendor_fkey FOREIGN KEY (company_id,vendor_id)
      REFERENCES public.vendors(company_id,id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_single_party_chk') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_single_party_chk CHECK (customer_id IS NULL OR vendor_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND conname='payments_allocation_amounts_chk') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_allocation_amounts_chk CHECK (
      applied_amount>=0 AND credit_applied_amount>=0 AND unapplied_amount>=0
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL,
  invoice_id UUID,
  bill_id UUID,
  amount NUMERIC(18,4) NOT NULL,
  cash_amount NUMERIC(18,4) NOT NULL,
  credit_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  exchange_rate NUMERIC(18,8),
  source_system TEXT NOT NULL DEFAULT 'HISAB',
  source_payment_id TEXT,
  source_line_key TEXT NOT NULL,
  source_target_id TEXT,
  source_credit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  local_credit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocations_company_payment_fkey FOREIGN KEY (company_id,payment_id)
    REFERENCES public.payments(company_id,id) ON DELETE CASCADE,
  CONSTRAINT payment_allocations_company_invoice_fkey FOREIGN KEY (company_id,invoice_id)
    REFERENCES public.invoices(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocations_company_bill_fkey FOREIGN KEY (company_id,bill_id)
    REFERENCES public.bills(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocations_single_target_chk CHECK ((invoice_id IS NOT NULL) <> (bill_id IS NOT NULL)),
  CONSTRAINT payment_allocations_amount_chk CHECK (
    amount>0 AND cash_amount>=0 AND credit_amount>=0 AND amount=ROUND(cash_amount+credit_amount,4)
  ),
  CONSTRAINT payment_allocations_rate_chk CHECK (exchange_rate IS NULL OR exchange_rate>0),
  UNIQUE (company_id,payment_id,source_system,source_line_key)
);

CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON public.payment_allocations(company_id,invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_allocations_bill_idx ON public.payment_allocations(company_id,bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_allocations_source_idx ON public.payment_allocations(company_id,source_system,source_payment_id,source_target_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_allocations_tenant ON public.payment_allocations;
CREATE POLICY payment_allocations_tenant ON public.payment_allocations FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));
DROP POLICY IF EXISTS payment_allocations_service ON public.payment_allocations;
CREATE POLICY payment_allocations_service ON public.payment_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.refresh_payment_document_balances(
  p_company_id UUID,p_invoice_ids UUID[],p_bill_ids UUID[]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.invoices document SET
    amount_paid=LEAST(document.total,COALESCE(applied.total,0)),
    balance=GREATEST(document.total-COALESCE(applied.total,0),0),
    status=CASE WHEN COALESCE(applied.total,0)>=document.total THEN 'PAID'
      WHEN COALESCE(applied.total,0)>0 THEN 'PARTIAL'
      WHEN document.status IN ('PAID','PARTIAL') THEN 'SENT' ELSE document.status END,
    updated_at=now()
  FROM (SELECT candidate.id,COALESCE(SUM(allocation.amount),0) total
    FROM public.invoices candidate LEFT JOIN public.payment_allocations allocation
      ON allocation.company_id=candidate.company_id AND allocation.invoice_id=candidate.id
    WHERE candidate.company_id=p_company_id AND candidate.id=ANY(COALESCE(p_invoice_ids,'{}'::UUID[]))
    GROUP BY candidate.id) applied
  WHERE document.company_id=p_company_id AND document.id=applied.id;

  UPDATE public.bills document SET
    amount_paid=LEAST(document.total,COALESCE(applied.total,0)),
    balance=GREATEST(document.total-COALESCE(applied.total,0),0),
    status=CASE WHEN COALESCE(applied.total,0)>=document.total THEN 'PAID'
      WHEN COALESCE(applied.total,0)>0 THEN 'PARTIAL'
      WHEN document.status IN ('PAID','PARTIAL') THEN 'RECEIVED' ELSE document.status END,
    updated_at=now()
  FROM (SELECT candidate.id,COALESCE(SUM(allocation.amount),0) total
    FROM public.bills candidate LEFT JOIN public.payment_allocations allocation
      ON allocation.company_id=candidate.company_id AND allocation.bill_id=candidate.id
    WHERE candidate.company_id=p_company_id AND candidate.id=ANY(COALESCE(p_bill_ids,'{}'::UUID[]))
    GROUP BY candidate.id) applied
  WHERE document.company_id=p_company_id AND document.id=applied.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_payment_allocations(
  p_company_id UUID,p_payment_id UUID,p_allocations JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  old_invoice_ids UUID[];
  old_bill_ids UUID[];
  old_credit_ids UUID[];
  new_invoice_ids UUID[];
  new_bill_ids UUID[];
  new_credit_ids UUID[];
  cash_total NUMERIC(18,4);
  credit_total NUMERIC(18,4);
BEGIN
  SELECT * INTO payment_row FROM public.payments
    WHERE company_id=p_company_id AND id=p_payment_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF jsonb_typeof(COALESCE(p_allocations,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Allocations must be an array'; END IF;

  SELECT array_agg(DISTINCT invoice_id) FILTER(WHERE invoice_id IS NOT NULL),
         array_agg(DISTINCT bill_id) FILTER(WHERE bill_id IS NOT NULL)
    INTO old_invoice_ids,old_bill_ids FROM public.payment_allocations
    WHERE company_id=p_company_id AND payment_id=p_payment_id;
  SELECT array_agg(DISTINCT credit_id::UUID) INTO old_credit_ids FROM public.payment_allocations allocation
    CROSS JOIN LATERAL jsonb_array_elements_text(allocation.local_credit_ids) credit_id
    WHERE allocation.company_id=p_company_id AND allocation.payment_id=p_payment_id;
  DELETE FROM public.payment_allocations WHERE company_id=p_company_id AND payment_id=p_payment_id;

  INSERT INTO public.payment_allocations(
    company_id,payment_id,invoice_id,bill_id,amount,cash_amount,credit_amount,currency,exchange_rate,
    source_system,source_payment_id,source_line_key,source_target_id,source_credit_ids,local_credit_ids,metadata
  ) SELECT p_company_id,p_payment_id,item.invoice_id,item.bill_id,ROUND(item.amount,4),ROUND(item.cash_amount,4),
      ROUND(item.credit_amount,4),UPPER(item.currency),item.exchange_rate,COALESCE(item.source_system,'HISAB'),
      item.source_payment_id,item.source_line_key,item.source_target_id,COALESCE(item.source_credit_ids,'[]'::jsonb),
      COALESCE(item.local_credit_ids,'[]'::jsonb),COALESCE(item.metadata,'{}'::jsonb)
    FROM jsonb_to_recordset(COALESCE(p_allocations,'[]'::jsonb)) AS item(
      invoice_id UUID,bill_id UUID,amount NUMERIC,cash_amount NUMERIC,credit_amount NUMERIC,currency TEXT,
      exchange_rate NUMERIC,source_system TEXT,source_payment_id TEXT,source_line_key TEXT,source_target_id TEXT,
      source_credit_ids JSONB,local_credit_ids JSONB,metadata JSONB
    );

  SELECT COALESCE(SUM(cash_amount),0),COALESCE(SUM(credit_amount),0),
         array_agg(DISTINCT invoice_id) FILTER(WHERE invoice_id IS NOT NULL),
         array_agg(DISTINCT bill_id) FILTER(WHERE bill_id IS NOT NULL)
    INTO cash_total,credit_total,new_invoice_ids,new_bill_ids FROM public.payment_allocations
    WHERE company_id=p_company_id AND payment_id=p_payment_id;
  SELECT array_agg(DISTINCT credit_id::UUID) INTO new_credit_ids FROM public.payment_allocations allocation
    CROSS JOIN LATERAL jsonb_array_elements_text(allocation.local_credit_ids) credit_id
    WHERE allocation.company_id=p_company_id AND allocation.payment_id=p_payment_id;
  IF cash_total>payment_row.amount THEN RAISE EXCEPTION 'Cash allocations exceed payment amount'; END IF;

  UPDATE public.payments SET
    invoice_id=(SELECT invoice_id FROM public.payment_allocations WHERE company_id=p_company_id AND payment_id=p_payment_id AND invoice_id IS NOT NULL ORDER BY source_line_key LIMIT 1),
    bill_id=(SELECT bill_id FROM public.payment_allocations WHERE company_id=p_company_id AND payment_id=p_payment_id AND bill_id IS NOT NULL ORDER BY source_line_key LIMIT 1),
    customer_id=COALESCE((SELECT invoice.customer_id FROM public.payment_allocations allocation JOIN public.invoices invoice ON invoice.company_id=allocation.company_id AND invoice.id=allocation.invoice_id WHERE allocation.company_id=p_company_id AND allocation.payment_id=p_payment_id LIMIT 1),payment_row.customer_id),
    vendor_id=COALESCE((SELECT bill.vendor_id FROM public.payment_allocations allocation JOIN public.bills bill ON bill.company_id=allocation.company_id AND bill.id=allocation.bill_id WHERE allocation.company_id=p_company_id AND allocation.payment_id=p_payment_id LIMIT 1),payment_row.vendor_id),
    applied_amount=cash_total,credit_applied_amount=credit_total,unapplied_amount=GREATEST(payment_row.amount-cash_total,0)
  WHERE company_id=p_company_id AND id=p_payment_id;

  PERFORM public.refresh_payment_document_balances(p_company_id,
    ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(old_invoice_ids,'{}'::UUID[])||COALESCE(new_invoice_ids,'{}'::UUID[])) value),
    ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(old_bill_ids,'{}'::UUID[])||COALESCE(new_bill_ids,'{}'::UUID[])) value));

  UPDATE public.invoices credit SET amount_paid=LEAST(credit.total,COALESCE(applied.total,0)),balance=GREATEST(credit.total-COALESCE(applied.total,0),0),
    status=CASE WHEN COALESCE(applied.total,0)>=credit.total THEN 'PAID' WHEN COALESCE(applied.total,0)>0 THEN 'PARTIAL' ELSE 'SENT' END,updated_at=now()
  FROM (SELECT document.id,COALESCE(SUM(allocation.credit_amount),0) total FROM public.invoices document
    LEFT JOIN public.payment_allocations allocation ON allocation.company_id=document.company_id AND allocation.local_credit_ids ? document.id::TEXT
    WHERE document.company_id=p_company_id AND document.invoice_type='CREDIT_NOTE' AND document.id=ANY(COALESCE(old_credit_ids,'{}'::UUID[])||COALESCE(new_credit_ids,'{}'::UUID[])) GROUP BY document.id) applied
  WHERE credit.company_id=p_company_id AND credit.id=applied.id;

  UPDATE public.vendor_credits credit SET applied_amount=LEAST(credit.total,COALESCE(applied.total,0)),balance=GREATEST(credit.total-COALESCE(applied.total,0),0),
    status=CASE WHEN COALESCE(applied.total,0)>=credit.total THEN 'CLOSED' WHEN COALESCE(applied.total,0)>0 THEN 'PARTIAL' ELSE 'OPEN' END
  FROM (SELECT document.id,COALESCE(SUM(allocation.credit_amount),0) total FROM public.vendor_credits document
    LEFT JOIN public.payment_allocations allocation ON allocation.company_id=document.company_id AND allocation.local_credit_ids ? document.id::TEXT
    WHERE document.company_id=p_company_id AND document.id=ANY(COALESCE(old_credit_ids,'{}'::UUID[])||COALESCE(new_credit_ids,'{}'::UUID[])) GROUP BY document.id) applied
  WHERE credit.company_id=p_company_id AND credit.id=applied.id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_payment_allocations(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_payment_document_balances(UUID,UUID[],UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_payment_allocations(UUID,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_payment_document_balances(UUID,UUID[],UUID[]) TO service_role;

-- Backfill legacy one-document payments without changing their accounting history.
INSERT INTO public.payment_allocations(company_id,payment_id,invoice_id,bill_id,amount,cash_amount,credit_amount,currency,exchange_rate,source_system,source_payment_id,source_line_key)
SELECT payment.company_id,payment.id,payment.invoice_id,payment.bill_id,payment.amount,payment.amount,0,
  COALESCE(
    CASE WHEN payment.invoice_id IS NOT NULL THEN invoice.currency END,
    CASE WHEN payment.bill_id IS NOT NULL THEN company.currency END,
    company.currency
  ),
  payment.exchange_rate,'LEGACY',payment.legacy_id,'legacy:0'
FROM public.payments payment
LEFT JOIN public.invoices invoice
  ON invoice.company_id=payment.company_id AND invoice.id=payment.invoice_id
LEFT JOIN public.bills bill
  ON bill.company_id=payment.company_id AND bill.id=payment.bill_id
LEFT JOIN public.companies company
  ON company.id=payment.company_id
WHERE payment.deleted_at IS NULL AND (payment.invoice_id IS NOT NULL OR payment.bill_id IS NOT NULL)
ON CONFLICT (company_id,payment_id,source_system,source_line_key) DO NOTHING;

UPDATE public.payments payment SET applied_amount=summary.cash_amount,credit_applied_amount=summary.credit_amount,
  unapplied_amount=GREATEST(payment.amount-summary.cash_amount,0)
FROM (SELECT company_id,payment_id,SUM(cash_amount) cash_amount,SUM(credit_amount) credit_amount
  FROM public.payment_allocations GROUP BY company_id,payment_id) summary
WHERE payment.company_id=summary.company_id AND payment.id=summary.payment_id;
