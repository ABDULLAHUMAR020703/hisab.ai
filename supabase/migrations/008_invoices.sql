-- Phase B prep: invoices, lines, payments (full ZATCA invoice field parity)
-- Depends on: 006_accounting_core, 007_customers_vendors

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  invoice_no TEXT NOT NULL,
  invoice_uuid TEXT,
  invoice_hash TEXT,
  previous_invoice_hash TEXT,
  invoice_type public.invoice_type NOT NULL DEFAULT 'STANDARD',
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL,
  issue_time TEXT,
  due_date TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  zatca_status public.zatca_invoice_status NOT NULL DEFAULT 'DRAFT',
  clearance_status TEXT,
  zatca_response_code TEXT,
  zatca_response_message TEXT,
  zatca_failure_code TEXT,
  zatca_request_id TEXT,
  zatca_response_payload JSONB,
  cleared_invoice_payload JSONB,
  signed_xml TEXT,
  zatca_submission_date TIMESTAMPTZ,
  notes TEXT,
  terms TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurring_day INT,
  next_due_date TIMESTAMPTZ,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, invoice_no),
  UNIQUE (company_id, invoice_uuid)
);

-- Hash chain / ICV queries (matches hash/previous.ts ordering by created_at)
CREATE INDEX invoices_company_hash_chain_idx
  ON public.invoices (company_id, created_at ASC)
  WHERE invoice_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX invoices_company_zatca_status_idx
  ON public.invoices (company_id, zatca_status)
  WHERE deleted_at IS NULL;

CREATE INDEX invoices_company_pih_lookup_idx
  ON public.invoices (company_id, created_at DESC)
  WHERE invoice_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX invoices_legacy_id_idx ON public.invoices (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE INDEX invoices_zatca_request_id_idx
  ON public.invoices (company_id, zatca_request_id)
  WHERE zatca_request_id IS NOT NULL;

CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 15,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0
);

CREATE INDEX invoice_lines_invoice_id_idx ON public.invoice_lines (invoice_id);
CREATE INDEX invoice_lines_company_id_idx ON public.invoice_lines (company_id);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  payment_no TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18, 4) NOT NULL,
  method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  reference TEXT,
  notes TEXT,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, payment_no),
  CONSTRAINT payments_invoice_or_bill_chk CHECK (
    invoice_id IS NOT NULL OR bill_id IS NOT NULL OR (invoice_id IS NULL AND bill_id IS NULL)
  )
);

CREATE INDEX payments_company_id_idx ON public.payments (company_id);
CREATE INDEX payments_invoice_id_idx ON public.payments (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX payments_bill_id_idx ON public.payments (bill_id) WHERE bill_id IS NOT NULL;

-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant ON public.invoices FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY invoices_service ON public.invoices FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY invoice_lines_tenant ON public.invoice_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY invoice_lines_service ON public.invoice_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY payments_tenant ON public.payments FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY payments_service ON public.payments FOR ALL TO service_role USING (true) WITH CHECK (true);
