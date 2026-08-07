-- Native, accounting-safe Sales Receipts with exact QuickBooks relationships.
ALTER TABLE public.sales_receipts ADD CONSTRAINT sales_receipts_company_id_id_key UNIQUE(company_id,id);
ALTER TABLE public.sales_receipts
  ADD COLUMN IF NOT EXISTS legacy_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS deposit_account_id UUID,
  ADD COLUMN IF NOT EXISTS source_deposit_account_id TEXT,
  ADD COLUMN IF NOT EXISTS source_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS base_subtotal NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS base_tax_amount NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS source_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT sales_receipts_company_deposit_account_fkey FOREIGN KEY(company_id,deposit_account_id) REFERENCES public.chart_of_accounts(company_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT sales_receipts_amounts_chk CHECK(subtotal>=0 AND tax_amount>=0 AND total>=0 AND ABS(subtotal+tax_amount-total)<=0.0001);
CREATE UNIQUE INDEX IF NOT EXISTS sales_receipts_legacy_source_uniq ON public.sales_receipts(company_id,legacy_id) WHERE legacy_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.sales_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_receipt_id UUID NOT NULL,
  line_no INT NOT NULL,
  source_line_id TEXT,
  detail_type TEXT NOT NULL DEFAULT 'SalesItemLineDetail',
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
  CONSTRAINT sales_receipt_lines_company_receipt_fkey FOREIGN KEY(company_id,sales_receipt_id) REFERENCES public.sales_receipts(company_id,id) ON DELETE CASCADE,
  CONSTRAINT sales_receipt_lines_company_account_fkey FOREIGN KEY(company_id,account_id) REFERENCES public.chart_of_accounts(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipt_lines_company_item_fkey FOREIGN KEY(company_id,inventory_item_id) REFERENCES public.inventory_items(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipt_lines_company_cost_center_fkey FOREIGN KEY(company_id,cost_center_id) REFERENCES public.cost_centers(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipt_lines_amount_chk CHECK(quantity>=0),
  UNIQUE(company_id,sales_receipt_id,line_no)
);
CREATE INDEX sales_receipt_lines_item_idx ON public.sales_receipt_lines(company_id,inventory_item_id) WHERE inventory_item_id IS NOT NULL;
ALTER TABLE public.sales_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_receipt_lines_tenant ON public.sales_receipt_lines FOR ALL TO authenticated USING(company_id IN (SELECT public.user_company_ids())) WITH CHECK(company_id IN (SELECT public.user_company_ids()));
CREATE POLICY sales_receipt_lines_service ON public.sales_receipt_lines FOR ALL TO service_role USING(true) WITH CHECK(true);

UPDATE public.sales_receipts receipt SET legacy_id=record.source_id,source_payload_hash=record.payload_hash,updated_at=now()
FROM public.quickbooks_migration_records record WHERE record.company_id=receipt.company_id AND record.entity_type='SalesReceipt' AND record.local_table='sales_receipts' AND record.local_id=receipt.id;
