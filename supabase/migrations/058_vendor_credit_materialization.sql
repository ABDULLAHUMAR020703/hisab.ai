-- Native, accounting-safe Vendor Credit documents and bill applications.
-- Composite parent keys are shared by this and subsequent native transaction-line migrations.
CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_company_id_id_uniq ON public.chart_of_accounts(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_company_id_id_uniq ON public.inventory_items(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_company_id_id_uniq ON public.cost_centers(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_company_id_id_uniq ON public.payments(company_id,id);
ALTER TABLE public.vendor_credits ADD CONSTRAINT vendor_credits_company_id_id_key UNIQUE(company_id,id);
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_company_id_id_key UNIQUE(company_id,id);
ALTER TABLE public.vendor_credits
  ADD COLUMN IF NOT EXISTS legacy_id TEXT,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS ap_account_id UUID,
  ADD COLUMN IF NOT EXISTS base_subtotal NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS base_tax_amount NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS source_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT vendor_credits_company_ap_account_fkey FOREIGN KEY(company_id,ap_account_id) REFERENCES public.chart_of_accounts(company_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT vendor_credits_amounts_chk CHECK(subtotal>=0 AND tax_amount>=0 AND total>=0 AND applied_amount>=0 AND balance>=0 AND applied_amount<=total AND balance<=total AND ABS(applied_amount+balance-total)<=0.0001);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_credits_legacy_source_uniq ON public.vendor_credits(company_id,legacy_id) WHERE legacy_id IS NOT NULL AND deleted_at IS NULL;
UPDATE public.vendor_credits credit SET legacy_id=record.source_id,source_payload_hash=record.payload_hash,updated_at=now()
FROM public.quickbooks_migration_records record WHERE record.company_id=credit.company_id AND record.entity_type='VendorCredit' AND record.local_table='vendor_credits' AND record.local_id=credit.id;

CREATE TABLE public.vendor_credit_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_credit_id UUID NOT NULL,
  line_no INT NOT NULL,
  source_line_id TEXT,
  detail_type TEXT NOT NULL,
  account_id UUID,
  inventory_item_id UUID,
  cost_center_id UUID,
  tax_rate_id UUID,
  source_account_id TEXT,
  source_item_id TEXT,
  source_class_id TEXT,
  source_tax_code_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  amount NUMERIC(18,4) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credit_lines_company_credit_fkey FOREIGN KEY(company_id,vendor_credit_id) REFERENCES public.vendor_credits(company_id,id) ON DELETE CASCADE,
  CONSTRAINT vendor_credit_lines_company_account_fkey FOREIGN KEY(company_id,account_id) REFERENCES public.chart_of_accounts(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT vendor_credit_lines_company_item_fkey FOREIGN KEY(company_id,inventory_item_id) REFERENCES public.inventory_items(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT vendor_credit_lines_company_cost_center_fkey FOREIGN KEY(company_id,cost_center_id) REFERENCES public.cost_centers(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT vendor_credit_lines_amount_chk CHECK(quantity>=0 AND unit_price>=0 AND amount>=0),
  UNIQUE(company_id,vendor_credit_id,line_no)
);
CREATE INDEX vendor_credit_lines_item_idx ON public.vendor_credit_lines(company_id,inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_source_line_uniq ON public.stock_movements(company_id,source_type,source_id,inventory_item_id,reference) WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND reference IS NOT NULL;

CREATE TABLE public.vendor_credit_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_credit_id UUID NOT NULL,
  bill_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  payment_allocation_id UUID NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  currency TEXT NOT NULL,
  source_bill_payment_id TEXT,
  source_line_key TEXT NOT NULL,
  source_bill_id TEXT,
  source_vendor_credit_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credit_applications_company_credit_fkey FOREIGN KEY(company_id,vendor_credit_id) REFERENCES public.vendor_credits(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT vendor_credit_applications_company_bill_fkey FOREIGN KEY(company_id,bill_id) REFERENCES public.bills(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT vendor_credit_applications_company_payment_fkey FOREIGN KEY(company_id,payment_id) REFERENCES public.payments(company_id,id) ON DELETE CASCADE,
  CONSTRAINT vendor_credit_applications_company_allocation_fkey FOREIGN KEY(company_id,payment_allocation_id) REFERENCES public.payment_allocations(company_id,id) ON DELETE CASCADE,
  CONSTRAINT vendor_credit_applications_amount_chk CHECK(amount>0),
  UNIQUE(company_id,payment_allocation_id,vendor_credit_id)
);
CREATE INDEX vendor_credit_applications_credit_idx ON public.vendor_credit_applications(company_id,vendor_credit_id);
CREATE INDEX vendor_credit_applications_bill_idx ON public.vendor_credit_applications(company_id,bill_id);

CREATE OR REPLACE FUNCTION public.materialize_vendor_credit_application() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE credit_id UUID;credit public.vendor_credits%ROWTYPE;bill_id UUID;bill_vendor_id UUID;bill_currency TEXT;credit_count INT;already_applied NUMERIC(18,4);
BEGIN
  IF NEW.credit_amount<=0 OR NEW.bill_id IS NULL THEN RETURN NEW; END IF;
  credit_count:=jsonb_array_length(COALESCE(NEW.local_credit_ids,'[]'::jsonb));
  credit_id:=(NEW.local_credit_ids->>0)::UUID;
  IF credit_count<>1 THEN RAISE EXCEPTION 'Vendor credit application must identify exactly one credit'; END IF;
  SELECT * INTO credit FROM public.vendor_credits WHERE company_id=NEW.company_id AND id=credit_id AND deleted_at IS NULL FOR UPDATE;
  SELECT target_bill.id,target_bill.vendor_id,company.currency INTO bill_id,bill_vendor_id,bill_currency
  FROM public.bills target_bill JOIN public.companies company ON company.id=target_bill.company_id
  WHERE target_bill.company_id=NEW.company_id AND target_bill.id=NEW.bill_id AND target_bill.deleted_at IS NULL FOR UPDATE OF target_bill;
  IF credit.id IS NULL OR bill_id IS NULL THEN RAISE EXCEPTION 'Vendor credit or target bill not found'; END IF;
  IF credit.vendor_id<>bill_vendor_id THEN RAISE EXCEPTION 'Vendor credit and bill must belong to the same vendor'; END IF;
  IF UPPER(credit.currency)<>UPPER(NEW.currency) OR UPPER(bill_currency)<>UPPER(NEW.currency) THEN RAISE EXCEPTION 'Vendor credit, bill, and application currency must match'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO already_applied FROM public.vendor_credit_applications WHERE company_id=NEW.company_id AND vendor_credit_id=credit.id;
  IF already_applied+NEW.credit_amount>credit.total+0.0001 THEN RAISE EXCEPTION 'Vendor credit is applied above its total'; END IF;
  INSERT INTO public.vendor_credit_applications(company_id,vendor_credit_id,bill_id,payment_id,payment_allocation_id,amount,currency,source_bill_payment_id,source_line_key,source_bill_id,source_vendor_credit_id)
  VALUES(NEW.company_id,credit.id,bill_id,NEW.payment_id,NEW.id,NEW.credit_amount,NEW.currency,NEW.source_payment_id,NEW.source_line_key,NEW.source_target_id,NEW.source_credit_ids->>0);
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocations_materialize_vendor_credit AFTER INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.materialize_vendor_credit_application();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.payment_allocations allocation WHERE allocation.credit_amount>0 AND allocation.bill_id IS NOT NULL AND jsonb_array_length(allocation.local_credit_ids)<>1) THEN RAISE EXCEPTION 'Existing vendor-credit allocations are ambiguous and must be repaired before migration'; END IF;
END $$;
INSERT INTO public.vendor_credit_applications(company_id,vendor_credit_id,bill_id,payment_id,payment_allocation_id,amount,currency,source_bill_payment_id,source_line_key,source_bill_id,source_vendor_credit_id)
SELECT allocation.company_id,(allocation.local_credit_ids->>0)::UUID,allocation.bill_id,allocation.payment_id,allocation.id,allocation.credit_amount,allocation.currency,allocation.source_payment_id,allocation.source_line_key,allocation.source_target_id,allocation.source_credit_ids->>0
FROM public.payment_allocations allocation WHERE allocation.credit_amount>0 AND allocation.bill_id IS NOT NULL
ON CONFLICT(company_id,payment_allocation_id,vendor_credit_id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.vendor_credit_applications application JOIN public.vendor_credits credit ON credit.company_id=application.company_id AND credit.id=application.vendor_credit_id JOIN public.bills bill ON bill.company_id=application.company_id AND bill.id=application.bill_id JOIN public.companies company ON company.id=bill.company_id WHERE credit.vendor_id<>bill.vendor_id OR UPPER(credit.currency)<>UPPER(application.currency) OR UPPER(company.currency)<>UPPER(application.currency)) THEN RAISE EXCEPTION 'Existing Vendor Credit applications have invalid vendor or currency relationships'; END IF;
  IF EXISTS(SELECT 1 FROM public.vendor_credit_applications application JOIN public.vendor_credits credit ON credit.company_id=application.company_id AND credit.id=application.vendor_credit_id GROUP BY credit.id,credit.total HAVING SUM(application.amount)>credit.total+0.0001) THEN RAISE EXCEPTION 'Existing Vendor Credits are over-applied'; END IF;
END $$;

ALTER TABLE public.vendor_credit_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_credit_lines_tenant ON public.vendor_credit_lines FOR ALL TO authenticated USING(company_id IN (SELECT public.user_company_ids())) WITH CHECK(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY vendor_credit_lines_service ON public.vendor_credit_lines FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY vendor_credit_applications_tenant ON public.vendor_credit_applications FOR ALL TO authenticated USING(company_id IN (SELECT public.user_company_ids())) WITH CHECK(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY vendor_credit_applications_service ON public.vendor_credit_applications FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION public.materialize_vendor_credit_application() FROM PUBLIC;
