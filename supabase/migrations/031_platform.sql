-- Platform: audit logs, custom fields, documents, fixed assets, budgeting, migration wizard

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'TEXT',
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, entity_type, field_key)
);

CREATE TABLE public.custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL,
  value TEXT,
  UNIQUE (definition_id, entity_id)
);

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_no TEXT NOT NULL,
  name TEXT NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL,
  purchase_cost NUMERIC(18, 4) NOT NULL,
  salvage_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  useful_life_months INT NOT NULL DEFAULT 60,
  depreciation_method TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  accumulated_depreciation NUMERIC(18, 4) NOT NULL DEFAULT 0,
  account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_no)
);

CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name, fiscal_year)
);

CREATE TABLE public.budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  period_month INT NOT NULL,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  UNIQUE (budget_id, account_id, period_month)
);

CREATE TABLE public.migration_wizard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  step TEXT NOT NULL DEFAULT 'COA_TEMPLATE',
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_company_id_idx ON public.audit_logs (company_id);
CREATE INDEX documents_entity_idx ON public.documents (company_id, entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_wizard_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant ON public.audit_logs FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY custom_field_definitions_tenant ON public.custom_field_definitions FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY custom_field_values_tenant ON public.custom_field_values FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY documents_tenant ON public.documents FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY fixed_assets_tenant ON public.fixed_assets FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY budgets_tenant ON public.budgets FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY budget_lines_tenant ON public.budget_lines FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY migration_wizard_sessions_tenant ON public.migration_wizard_sessions FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
