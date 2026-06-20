-- Phase B prep: accounting core (GL, sequences, tax, expenses, payroll, inventory, receipts)
-- Depends on: 001_extensions, 002_enums, 003_companies, 004_auth_profiles, 005_company_users

CREATE TABLE public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  account_no TEXT NOT NULL,
  full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_no TEXT,
  account_type TEXT NOT NULL,
  sub_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, account_no)
);

CREATE INDEX chart_of_accounts_company_id_idx ON public.chart_of_accounts (company_id);
CREATE INDEX chart_of_accounts_company_active_idx ON public.chart_of_accounts (company_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX chart_of_accounts_legacy_id_idx ON public.chart_of_accounts (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TRIGGER chart_of_accounts_set_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'PROJECT',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, code)
);

CREATE INDEX cost_centers_company_id_idx ON public.cost_centers (company_id);

CREATE TRIGGER cost_centers_set_updated_at
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  type TEXT NOT NULL,
  prefix TEXT NOT NULL,
  next_no INT NOT NULL DEFAULT 1,
  UNIQUE (company_id, type)
);

CREATE INDEX sequences_company_id_idx ON public.sequences (company_id);

CREATE TABLE public.tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  name TEXT NOT NULL,
  rate NUMERIC(8, 4) NOT NULL,
  type TEXT NOT NULL DEFAULT 'VAT',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX tax_rates_company_id_idx ON public.tax_rates (company_id);
CREATE INDEX tax_rates_company_default_idx ON public.tax_rates (company_id, is_default) WHERE is_active = true AND deleted_at IS NULL;

CREATE TABLE public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  entry_no TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, entry_no)
);

CREATE INDEX journal_entries_company_id_idx ON public.journal_entries (company_id);
CREATE INDEX journal_entries_company_date_idx ON public.journal_entries (company_id, date);
CREATE INDEX journal_entries_company_status_idx ON public.journal_entries (company_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER journal_entries_set_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  journal_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  description TEXT,
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0
);

CREATE INDEX journal_lines_journal_id_idx ON public.journal_lines (journal_id);
CREATE INDEX journal_lines_company_account_idx ON public.journal_lines (company_id, account_id);

CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  vendor TEXT,
  amount NUMERIC(18, 4),
  date TIMESTAMPTZ,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'UNPROCESSED',
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX receipts_company_id_idx ON public.receipts (company_id);

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  expense_no TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  receipt_id UUID REFERENCES public.receipts(id) ON DELETE SET NULL,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, expense_no)
);

CREATE INDEX expenses_company_id_idx ON public.expenses (company_id);

CREATE TRIGGER expenses_set_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.expense_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0
);

CREATE INDEX expense_lines_expense_id_idx ON public.expense_lines (expense_id);

CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  employee_no TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  department TEXT,
  position TEXT,
  joining_date TIMESTAMPTZ NOT NULL,
  salary NUMERIC(18, 4) NOT NULL DEFAULT 0,
  salary_type TEXT NOT NULL DEFAULT 'MONTHLY',
  bank_account TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, employee_no)
);

CREATE INDEX employees_company_id_idx ON public.employees (company_id);

CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  payroll_no TEXT NOT NULL,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  period TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  basic_salary NUMERIC(18, 4) NOT NULL DEFAULT 0,
  allowances NUMERIC(18, 4) NOT NULL DEFAULT 0,
  deductions NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  net_salary NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, payroll_no)
);

CREATE INDEX payroll_entries_company_id_idx ON public.payroll_entries (company_id);
CREATE INDEX payroll_entries_employee_id_idx ON public.payroll_entries (employee_id);

CREATE TRIGGER payroll_entries_set_updated_at
  BEFORE UPDATE ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  payroll_id UUID NOT NULL REFERENCES public.payroll_entries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(18, 4) NOT NULL
);

CREATE INDEX payroll_lines_payroll_id_idx ON public.payroll_lines (payroll_id);

CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legacy_id TEXT,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'PCS',
  cost_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  sale_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  min_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, item_code)
);

CREATE INDEX inventory_items_company_id_idx ON public.inventory_items (company_id);

CREATE TRIGGER inventory_items_set_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY chart_of_accounts_tenant ON public.chart_of_accounts FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY chart_of_accounts_service ON public.chart_of_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY cost_centers_tenant ON public.cost_centers FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY cost_centers_service ON public.cost_centers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY sequences_tenant ON public.sequences FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY sequences_service ON public.sequences FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY tax_rates_tenant ON public.tax_rates FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY tax_rates_service ON public.tax_rates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY journal_entries_tenant ON public.journal_entries FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY journal_entries_service ON public.journal_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY journal_lines_tenant ON public.journal_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY journal_lines_service ON public.journal_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY receipts_tenant ON public.receipts FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY receipts_service ON public.receipts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY expenses_tenant ON public.expenses FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY expenses_service ON public.expenses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY expense_lines_tenant ON public.expense_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY expense_lines_service ON public.expense_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY employees_tenant ON public.employees FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY employees_service ON public.employees FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY payroll_entries_tenant ON public.payroll_entries FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY payroll_entries_service ON public.payroll_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY payroll_lines_tenant ON public.payroll_lines FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY payroll_lines_service ON public.payroll_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY inventory_items_tenant ON public.inventory_items FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL)
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY inventory_items_service ON public.inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);
