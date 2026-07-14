-- Enterprise multi-currency accounting and tax engine upgrade

-- ---------------------------------------------------------------------------
-- Currency roles: base (primary), transaction, reporting
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS reporting_currency TEXT;

UPDATE public.companies
SET reporting_currency = COALESCE(reporting_currency, currency, 'SAR');

ALTER TABLE public.company_currencies
  ADD COLUMN IF NOT EXISTS is_reporting BOOLEAN NOT NULL DEFAULT false;

UPDATE public.company_currencies cc
SET is_reporting = true
FROM public.companies c
WHERE cc.company_id = c.id
  AND cc.code = COALESCE(c.reporting_currency, c.currency)
  AND cc.is_primary = false
  AND NOT EXISTS (
    SELECT 1 FROM public.company_currencies r
    WHERE r.company_id = cc.company_id AND r.is_reporting = true
  );

UPDATE public.company_currencies cc
SET is_reporting = true
FROM public.companies c
WHERE cc.company_id = c.id
  AND cc.is_primary = true
  AND NOT EXISTS (
    SELECT 1 FROM public.company_currencies r
    WHERE r.company_id = cc.company_id AND r.is_reporting = true
  );

-- Exchange rate history with source tracking
ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exchange_rates_lookup_idx
  ON public.exchange_rates (company_id, from_currency, to_currency, effective_date DESC);

-- FX gain/loss account mapping per company
CREATE TABLE IF NOT EXISTS public.currency_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  realized_gain_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  realized_loss_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  unrealized_gain_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  unrealized_loss_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  auto_fetch_rates BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.currency_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY currency_settings_tenant ON public.currency_settings
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- Multi-currency document amounts
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS base_subtotal NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS base_tax_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS base_total NUMERIC(18, 4);

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS base_subtotal NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS base_tax_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS base_total NUMERIC(18, 4);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS invoice_exchange_rate NUMERIC(18, 8);

-- Ledger multi-currency columns (transaction currency remains in debit/credit for compat)
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS base_currency TEXT,
  ADD COLUMN IF NOT EXISTS base_debit NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS base_credit NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS reporting_currency TEXT,
  ADD COLUMN IF NOT EXISTS reporting_debit NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS reporting_credit NUMERIC(18, 4);

CREATE INDEX IF NOT EXISTS ledger_entries_currency_idx
  ON public.ledger_entries (company_id, currency, entry_date DESC);

-- FX revaluation
CREATE TYPE public.fx_revaluation_status AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS public.fx_revaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  revaluation_date TIMESTAMPTZ NOT NULL,
  status public.fx_revaluation_status NOT NULL DEFAULT 'DRAFT',
  base_currency TEXT NOT NULL,
  reporting_currency TEXT NOT NULL,
  total_unrealized_gain NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_unrealized_loss NUMERIC(18, 4) NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fx_revaluation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revaluation_id UUID NOT NULL REFERENCES public.fx_revaluations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL,
  balance_transaction NUMERIC(18, 4) NOT NULL DEFAULT 0,
  prior_rate NUMERIC(18, 8) NOT NULL DEFAULT 1,
  new_rate NUMERIC(18, 8) NOT NULL DEFAULT 1,
  prior_base_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  new_base_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(18, 4) NOT NULL DEFAULT 0
);

CREATE INDEX fx_revaluations_company_date_idx ON public.fx_revaluations (company_id, revaluation_date DESC);

ALTER TABLE public.fx_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_revaluation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx_revaluations_tenant ON public.fx_revaluations
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY fx_revaluation_lines_tenant ON public.fx_revaluation_lines
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'FX_REVALUATION';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'REALIZED_FX';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'UNREALIZED_FX';

-- ---------------------------------------------------------------------------
-- Tax engine
-- ---------------------------------------------------------------------------
CREATE TYPE public.tax_calculation_mode AS ENUM ('EXCLUSIVE', 'INCLUSIVE');
CREATE TYPE public.tax_compound_method AS ENUM ('ADDITIVE', 'COMPOUND');

CREATE TABLE IF NOT EXISTS public.tax_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  compound_method public.tax_compound_method NOT NULL DEFAULT 'ADDITIVE',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.tax_group_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tax_group_id UUID NOT NULL REFERENCES public.tax_groups(id) ON DELETE CASCADE,
  tax_rate_id UUID NOT NULL REFERENCES public.tax_rates(id) ON DELETE CASCADE,
  sequence INT NOT NULL DEFAULT 1,
  UNIQUE (tax_group_id, tax_rate_id)
);

ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS tax_mode public.tax_calculation_mode NOT NULL DEFAULT 'EXCLUSIVE',
  ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_withholding BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_group_id UUID REFERENCES public.tax_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gl_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.tax_exemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  exemption_code TEXT,
  tax_rate_id UUID REFERENCES public.tax_rates(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  region_code TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.regional_tax_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  document_type TEXT NOT NULL,
  default_tax_rate_id UUID REFERENCES public.tax_rates(id) ON DELETE SET NULL,
  reverse_charge_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, region_code, document_type)
);

CREATE INDEX tax_exemptions_company_idx ON public.tax_exemptions (company_id, is_active);
CREATE INDEX regional_tax_rules_lookup_idx ON public.regional_tax_rules (company_id, region_code, document_type);

ALTER TABLE public.tax_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_group_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regional_tax_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tax_groups_tenant ON public.tax_groups
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL);
CREATE POLICY tax_group_rates_tenant ON public.tax_group_rates
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY tax_exemptions_tenant ON public.tax_exemptions
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL);
CREATE POLICY regional_tax_rules_tenant ON public.regional_tax_rules
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- Seed FX accounts for companies missing them
INSERT INTO public.chart_of_accounts (
  company_id, account_no, full_name, name, parent_no, account_type, sub_type,
  canonical_type, normal_balance, is_active, balance
)
SELECT c.id, '61-6104', 'EXPENSES:Operating Expenses:Realized FX Loss', 'Realized FX Loss',
  '61', 'Expenses', 'Expenses', 'Expense', 'DEBIT', true, 0
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_no = '61-6104' AND a.deleted_at IS NULL
);

INSERT INTO public.chart_of_accounts (
  company_id, account_no, full_name, name, parent_no, account_type, sub_type,
  canonical_type, normal_balance, is_active, balance
)
SELECT c.id, '41-4103', 'INCOME:Sales Income:Realized FX Gain', 'Realized FX Gain',
  '41', 'Income', 'Income', 'Income', 'CREDIT', true, 0
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_no = '41-4103' AND a.deleted_at IS NULL
);

INSERT INTO public.chart_of_accounts (
  company_id, account_no, full_name, name, parent_no, account_type, sub_type,
  canonical_type, normal_balance, is_active, balance
)
SELECT c.id, '61-6105', 'EXPENSES:Operating Expenses:Unrealized FX Loss', 'Unrealized FX Loss',
  '61', 'Expenses', 'Expenses', 'Expense', 'DEBIT', true, 0
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_no = '61-6105' AND a.deleted_at IS NULL
);

INSERT INTO public.chart_of_accounts (
  company_id, account_no, full_name, name, parent_no, account_type, sub_type,
  canonical_type, normal_balance, is_active, balance
)
SELECT c.id, '41-4104', 'INCOME:Sales Income:Unrealized FX Gain', 'Unrealized FX Gain',
  '41', 'Income', 'Income', 'Income', 'CREDIT', true, 0
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a
  WHERE a.company_id = c.id AND a.account_no = '41-4104' AND a.deleted_at IS NULL
);

-- Link currency settings to FX accounts
INSERT INTO public.currency_settings (company_id, realized_gain_account_id, realized_loss_account_id, unrealized_gain_account_id, unrealized_loss_account_id)
SELECT
  c.id,
  (SELECT id FROM public.chart_of_accounts WHERE company_id = c.id AND account_no = '41-4103' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM public.chart_of_accounts WHERE company_id = c.id AND account_no = '61-6104' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM public.chart_of_accounts WHERE company_id = c.id AND account_no = '41-4104' AND deleted_at IS NULL LIMIT 1),
  (SELECT id FROM public.chart_of_accounts WHERE company_id = c.id AND account_no = '61-6105' AND deleted_at IS NULL LIMIT 1)
FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;

-- Default Saudi VAT tax group (preserves existing VAT behavior)
INSERT INTO public.tax_groups (company_id, name, description, compound_method)
SELECT c.id, 'Standard VAT', 'Default Saudi VAT group', 'ADDITIVE'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_groups tg WHERE tg.company_id = c.id AND tg.name = 'Standard VAT'
);

INSERT INTO public.tax_group_rates (company_id, tax_group_id, tax_rate_id, sequence)
SELECT c.id, tg.id, tr.id, 1
FROM public.companies c
JOIN public.tax_groups tg ON tg.company_id = c.id AND tg.name = 'Standard VAT'
JOIN public.tax_rates tr ON tr.company_id = c.id AND tr.is_default = true AND tr.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_group_rates tgr WHERE tgr.tax_group_id = tg.id AND tgr.tax_rate_id = tr.id
);

-- Regional rule: Saudi Arabia standard VAT on invoices
INSERT INTO public.regional_tax_rules (company_id, region_code, document_type, default_tax_rate_id, reverse_charge_default)
SELECT c.id, 'SA', 'INVOICE', tr.id, false
FROM public.companies c
JOIN public.tax_rates tr ON tr.company_id = c.id AND tr.is_default = true AND tr.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.regional_tax_rules r
  WHERE r.company_id = c.id AND r.region_code = 'SA' AND r.document_type = 'INVOICE'
);
