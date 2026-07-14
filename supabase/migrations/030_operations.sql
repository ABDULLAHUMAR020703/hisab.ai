-- Phase 6-8: Expenses, Inventory, Payroll enhancements

CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE public.expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  claim_no TEXT NOT NULL,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, claim_no)
);

CREATE TABLE public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  amount NUMERIC(18, 4) NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  next_run_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  amount NUMERIC(18, 4) NOT NULL,
  balance NUMERIC(18, 4) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  movement_no TEXT NOT NULL,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  reference TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, movement_no)
);

ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE TABLE public.salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE public.salary_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  structure_id UUID NOT NULL REFERENCES public.salary_structures(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'EARNING',
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hours_worked NUMERIC(8, 2) NOT NULL DEFAULT 8,
  overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PRESENT',
  UNIQUE (company_id, employee_id, date)
);

CREATE TABLE public.employee_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  principal NUMERIC(18, 4) NOT NULL,
  balance NUMERIC(18, 4) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_categories_tenant ON public.expense_categories FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY expense_claims_tenant ON public.expense_claims FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY recurring_expenses_tenant ON public.recurring_expenses FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY employee_advances_tenant ON public.employee_advances FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY stock_movements_tenant ON public.stock_movements FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY salary_structures_tenant ON public.salary_structures FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY salary_components_tenant ON public.salary_components FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY attendance_records_tenant ON public.attendance_records FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY employee_loans_tenant ON public.employee_loans FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
