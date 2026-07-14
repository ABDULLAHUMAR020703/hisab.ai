-- Phase 2: Master data entities

CREATE TABLE public.units_of_measure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code)
);

CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code)
);

CREATE TABLE public.payment_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  name TEXT NOT NULL,
  days INT NOT NULL DEFAULT 30,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, name)
);

CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code)
);

CREATE TABLE public.company_currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE public.exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate NUMERIC(18, 8) NOT NULL,
  effective_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, from_currency, to_currency, effective_date)
);

-- Wire tax rates and departments to transaction lines
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES public.tax_rates(id) ON DELETE SET NULL;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES public.tax_rates(id) ON DELETE SET NULL;
ALTER TABLE public.expense_lines ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES public.tax_rates(id) ON DELETE SET NULL;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS payment_term_id UUID REFERENCES public.payment_terms(id) ON DELETE SET NULL;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS payment_term_id UUID REFERENCES public.payment_terms(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.units_of_measure(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- Seed default payment terms per company
INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Net 30', 30, 'Payment due in 30 days'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Net 30'
);

INSERT INTO public.payment_terms (company_id, name, days, description)
SELECT c.id, 'Net 15', 15, 'Payment due in 15 days'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_terms pt WHERE pt.company_id = c.id AND pt.name = 'Net 15'
);

-- Seed company currencies from companies.currency
INSERT INTO public.company_currencies (company_id, code, name, symbol, is_primary, is_active)
SELECT c.id, c.currency, c.currency, c.currency, true, true
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_currencies cc WHERE cc.company_id = c.id AND cc.is_primary = true
);

-- Default exchange rates (1:1 for primary)
INSERT INTO public.exchange_rates (company_id, from_currency, to_currency, rate, effective_date)
SELECT c.id, c.currency, c.currency, 1, now()
FROM public.companies c
ON CONFLICT DO NOTHING;

-- Default UOM
INSERT INTO public.units_of_measure (company_id, code, name)
SELECT c.id, 'PCS', 'Pieces'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.units_of_measure u WHERE u.company_id = c.id AND u.code = 'PCS');

INSERT INTO public.units_of_measure (company_id, code, name)
SELECT c.id, 'SVC', 'Service'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.units_of_measure u WHERE u.company_id = c.id AND u.code = 'SVC');

-- RLS
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY units_of_measure_tenant ON public.units_of_measure FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY warehouses_tenant ON public.warehouses FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY payment_terms_tenant ON public.payment_terms FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY departments_tenant ON public.departments FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY company_currencies_tenant ON public.company_currencies FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY exchange_rates_tenant ON public.exchange_rates FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
