-- Product parity: refund receipts, billable work, credit-card payments,
-- tax agencies, customer types, and reusable payment methods.

ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'REFUND_RECEIPT';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'REFUND_RECEIPT_VOID';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'CREDIT_CARD_PAYMENT';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'TAX_PAYMENT';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'TAX_REFUND';

CREATE TABLE public.customer_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, name)
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type_id UUID REFERENCES public.customer_types(id) ON DELETE SET NULL;

CREATE TABLE public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  method_type TEXT NOT NULL CHECK (method_type IN ('CASH','BANK_TRANSFER','CARD','CHEQUE','OTHER')),
  clearing_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code),
  UNIQUE (company_id, name)
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE public.sales_receipts ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL;
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID;
CREATE INDEX IF NOT EXISTS bank_transactions_source_idx ON public.bank_transactions(company_id, source_type, source_id);

CREATE TABLE public.refund_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  refund_no TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  source_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  date TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','VOID')),
  subtotal NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (total > 0),
  reason TEXT NOT NULL,
  reference TEXT,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, refund_no),
  CHECK (abs((subtotal + tax_amount) - total) <= 0.01)
);

CREATE TABLE public.refund_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  refund_receipt_id UUID NOT NULL REFERENCES public.refund_receipts(id) ON DELETE CASCADE,
  source_invoice_line_id UUID REFERENCES public.invoice_lines(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (amount >= 0)
);

CREATE TABLE public.time_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  activity_no TEXT NOT NULL,
  activity_date TIMESTAMPTZ NOT NULL,
  employee_id UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  service_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  hours NUMERIC(12,4) NOT NULL CHECK (hours > 0 AND hours <= 24),
  cost_rate NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  billing_rate NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (billing_rate >= 0),
  is_billable BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','INVOICED','PAID','CANCELLED')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  payroll_entry_id UUID REFERENCES public.payroll_entries(id) ON DELETE SET NULL,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, activity_no),
  CHECK ((employee_id IS NOT NULL)::int + (vendor_id IS NOT NULL)::int = 1),
  CHECK (NOT is_billable OR customer_id IS NOT NULL)
);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billable_status TEXT NOT NULL DEFAULT 'NOT_BILLABLE'
    CHECK (billable_status IN ('NOT_BILLABLE','UNBILLED','INVOICED')),
  ADD COLUMN IF NOT EXISTS billed_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(8,4) NOT NULL DEFAULT 0;

CREATE TABLE public.billable_charge_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_line_id UUID NOT NULL REFERENCES public.invoice_lines(id) ON DELETE CASCADE,
  time_activity_id UUID REFERENCES public.time_activities(id) ON DELETE RESTRICT,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE RESTRICT,
  cost_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  billed_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (billed_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((time_activity_id IS NOT NULL)::int + (expense_id IS NOT NULL)::int = 1),
  UNIQUE (time_activity_id),
  UNIQUE (expense_id)
);

CREATE TABLE public.credit_card_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_no TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  credit_card_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  fee_amount NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'SAR',
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','VOID')),
  reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_status IN ('UNMATCHED','MATCHED','RECONCILED')),
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, payment_no),
  CHECK (bank_account_id <> credit_card_account_id)
);

CREATE TABLE public.tax_agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  registration_number TEXT,
  liability_account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  receivable_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  payment_terms_days INT NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code),
  UNIQUE (company_id, name)
);

ALTER TABLE public.tax_rates ADD COLUMN IF NOT EXISTS tax_agency_id UUID REFERENCES public.tax_agencies(id) ON DELETE SET NULL;

CREATE TABLE public.tax_filing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tax_agency_id UUID NOT NULL REFERENCES public.tax_agencies(id) ON DELETE RESTRICT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FILED','PAID','CLOSED')),
  tax_collected NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_paid NUMERIC(18,4) NOT NULL DEFAULT 0,
  net_due NUMERIC(18,4) NOT NULL DEFAULT 0,
  filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, tax_agency_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE public.tax_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  settlement_no TEXT NOT NULL,
  tax_agency_id UUID NOT NULL REFERENCES public.tax_agencies(id) ON DELETE RESTRICT,
  filing_period_id UUID REFERENCES public.tax_filing_periods(id) ON DELETE SET NULL,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL,
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('PAYMENT','REFUND')),
  amount NUMERIC(18,4) NOT NULL CHECK (amount > 0),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','VOID')),
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, settlement_no)
);

CREATE INDEX refund_receipts_company_date_idx ON public.refund_receipts(company_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX time_activities_company_date_idx ON public.time_activities(company_id, activity_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX time_activities_unbilled_idx ON public.time_activities(company_id, customer_id, project_id) WHERE is_billable AND status = 'APPROVED' AND deleted_at IS NULL;
CREATE INDEX expenses_unbilled_idx ON public.expenses(company_id, customer_id, project_id) WHERE is_billable AND billable_status = 'UNBILLED' AND deleted_at IS NULL;
CREATE INDEX credit_card_payments_company_date_idx ON public.credit_card_payments(company_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX tax_filing_periods_company_due_idx ON public.tax_filing_periods(company_id, due_date);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_types','payment_methods','refund_receipts','refund_receipt_lines','time_activities','billable_charge_links','credit_card_payments','tax_agencies','tax_filing_periods','tax_settlements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id IN (SELECT public.user_company_ids())) WITH CHECK (company_id IN (SELECT public.user_company_ids()))', t || '_tenant', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service', t);
  END LOOP;
END $$;

INSERT INTO public.payment_methods (company_id, code, name, method_type)
SELECT c.id, seed.code, seed.name, seed.method_type
FROM public.companies c
CROSS JOIN (VALUES
  ('CASH','Cash','CASH'),
  ('BANK_TRANSFER','Bank Transfer','BANK_TRANSFER'),
  ('CARD','Card','CARD'),
  ('CHEQUE','Cheque','CHEQUE')
) AS seed(code,name,method_type)
ON CONFLICT (company_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_company_payment_methods()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payment_methods (company_id, code, name, method_type) VALUES
    (NEW.id, 'CASH', 'Cash', 'CASH'),
    (NEW.id, 'BANK_TRANSFER', 'Bank Transfer', 'BANK_TRANSFER'),
    (NEW.id, 'CARD', 'Card', 'CARD'),
    (NEW.id, 'CHEQUE', 'Cheque', 'CHEQUE')
  ON CONFLICT (company_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_seed_payment_methods ON public.companies;
CREATE TRIGGER companies_seed_payment_methods
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.seed_company_payment_methods();

UPDATE public.payments p SET payment_method_id = pm.id
FROM public.payment_methods pm
WHERE pm.company_id = p.company_id AND pm.code = upper(replace(p.method, ' ', '_')) AND p.payment_method_id IS NULL;

UPDATE public.sales_receipts sr SET payment_method_id = pm.id
FROM public.payment_methods pm
WHERE pm.company_id = sr.company_id AND pm.code = upper(replace(sr.payment_method, ' ', '_')) AND sr.payment_method_id IS NULL;
