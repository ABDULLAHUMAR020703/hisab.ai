-- Enterprise reporting framework (additive — no changes to existing report tables)

CREATE TYPE public.report_schedule_frequency AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY');
CREATE TYPE public.report_export_format AS ENUM ('JSON', 'CSV', 'XLSX', 'PDF', 'PRINT');
CREATE TYPE public.report_permission_level AS ENUM ('VIEW', 'RUN', 'EDIT', 'ADMIN');

-- Saved custom report definitions (designer output)
CREATE TABLE IF NOT EXISTS public.report_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_report_key TEXT NOT NULL,
  layout JSONB NOT NULL DEFAULT '{}',
  columns JSONB NOT NULL DEFAULT '[]',
  filters JSONB NOT NULL DEFAULT '{}',
  grouping JSONB NOT NULL DEFAULT '[]',
  sorting JSONB NOT NULL DEFAULT '[]',
  calculated_columns JSONB NOT NULL DEFAULT '[]',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (company_id, name)
);

-- Report templates (company-specific saved layouts referencing catalog keys)
CREATE TABLE IF NOT EXISTS public.report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_filters JSONB NOT NULL DEFAULT '{}',
  default_columns JSONB NOT NULL DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, report_key, name)
);

-- Scheduled report delivery
CREATE TABLE IF NOT EXISTS public.report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  definition_id UUID REFERENCES public.report_definitions(id) ON DELETE CASCADE,
  report_key TEXT,
  name TEXT NOT NULL,
  frequency public.report_schedule_frequency NOT NULL DEFAULT 'MONTHLY',
  cron_expression TEXT,
  filters JSONB NOT NULL DEFAULT '{}',
  export_format public.report_export_format NOT NULL DEFAULT 'PDF',
  email_recipients TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Report permissions per user/role
CREATE TABLE IF NOT EXISTS public.report_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_key TEXT,
  definition_id UUID REFERENCES public.report_definitions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.company_role,
  permission_level public.report_permission_level NOT NULL DEFAULT 'VIEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (report_key IS NOT NULL OR definition_id IS NOT NULL)
);

-- Materialized daily summaries for large-dataset performance
CREATE TABLE IF NOT EXISTS public.report_daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  canonical_type TEXT NOT NULL,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  cost_center_id UUID REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  entry_count INT NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, summary_date, canonical_type, account_id, cost_center_id, department_id)
);

CREATE INDEX report_daily_summaries_lookup_idx
  ON public.report_daily_summaries (company_id, summary_date, canonical_type);

CREATE INDEX IF NOT EXISTS ledger_entries_reporting_date_idx
  ON public.ledger_entries (company_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS ledger_entries_reporting_account_date_idx
  ON public.ledger_entries (company_id, account_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS ledger_entries_reporting_source_idx
  ON public.ledger_entries (company_id, source_type, entry_date DESC);

CREATE INDEX IF NOT EXISTS invoices_reporting_date_idx
  ON public.invoices (company_id, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bills_reporting_date_idx
  ON public.bills (company_id, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS expenses_reporting_date_idx
  ON public.expenses (company_id, date DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_definitions_tenant ON public.report_definitions
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY report_templates_tenant ON public.report_templates
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY report_schedules_tenant ON public.report_schedules
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY report_permissions_tenant ON public.report_permissions
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY report_daily_summaries_tenant ON public.report_daily_summaries
  FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
