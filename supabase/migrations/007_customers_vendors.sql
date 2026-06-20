-- Phase B prep: AR/AP master data and vendor bills
-- Depends on: 006_accounting_core

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  customer_no TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  street_address TEXT,
  building_number TEXT,
  district TEXT,
  city TEXT,
  country TEXT,
  postal_code TEXT,
  tax_id TEXT,
  credit_limit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  payment_terms INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, customer_no)
);

CREATE INDEX customers_company_id_idx ON public.customers (company_id);
CREATE INDEX customers_company_tax_id_idx ON public.customers (company_id, tax_id) WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX customers_legacy_id_idx ON public.customers (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  vendor_no TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  tax_id TEXT,
  payment_terms INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, vendor_no)
);

CREATE INDEX vendors_company_id_idx ON public.vendors (company_id);
CREATE INDEX vendors_legacy_id_idx ON public.vendors (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  bill_no TEXT NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  notes TEXT,
  reference TEXT,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, bill_no)
);

CREATE INDEX bills_company_id_idx ON public.bills (company_id);
CREATE INDEX bills_vendor_id_idx ON public.bills (vendor_id);
CREATE INDEX bills_company_status_idx ON public.bills (company_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER bills_set_updated_at
  BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 15,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0
);

CREATE INDEX bill_lines_bill_id_idx ON public.bill_lines (bill_id);

-- RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_tenant ON public.customers FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY customers_service ON public.customers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY vendors_tenant ON public.vendors FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY vendors_service ON public.vendors FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY bills_tenant ON public.bills FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY bills_service ON public.bills FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY bill_lines_tenant ON public.bill_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY bill_lines_service ON public.bill_lines FOR ALL TO service_role USING (true) WITH CHECK (true);
