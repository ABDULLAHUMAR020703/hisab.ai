-- Unified recurring transaction templates, schedules, execution history, and future attachments.

CREATE TABLE public.recurring_transaction_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('REMINDER', 'SCHEDULED', 'UNSCHEDULED')),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'BILL', 'NON_POSTING_CHARGE', 'CHEQUE', 'NON_POSTING_CREDIT',
    'CREDIT_CARD_CREDIT', 'CREDIT_NOTE', 'DEPOSIT', 'ESTIMATE', 'EXPENSE',
    'INVOICE', 'JOURNAL_ENTRY', 'PAYMENT', 'SALES_RECEIPT', 'TRANSFER',
    'SUPPLIER_CREDIT', 'PURCHASE_ORDER'
  )),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  reference_number TEXT,
  notes TEXT,
  amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  transaction_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE public.recurring_transaction_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.recurring_transaction_templates(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM')),
  interval_count INT NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  custom_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  previous_run_date TIMESTAMPTZ,
  next_run_date TIMESTAMPTZ,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  last_error TEXT,
  processing_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, template_id),
  CONSTRAINT recurring_schedule_dates_chk CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE public.recurring_transaction_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.recurring_transaction_templates(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES public.recurring_transaction_schedules(id) ON DELETE SET NULL,
  execution_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'REMINDER_SENT', 'SKIPPED')),
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'AUTOMATIC', 'RETRY')),
  generated_transaction_type TEXT,
  generated_transaction_id UUID,
  generated_transaction_number TEXT,
  executed_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  error TEXT,
  attempt_no INT NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.recurring_transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.recurring_transaction_templates(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX recurring_templates_company_status_idx
  ON public.recurring_transaction_templates (company_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX recurring_templates_company_name_idx
  ON public.recurring_transaction_templates (company_id, lower(template_name))
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX recurring_templates_company_name_unique_idx
  ON public.recurring_transaction_templates (company_id, lower(template_name))
  WHERE deleted_at IS NULL;
CREATE INDEX recurring_templates_customer_idx ON public.recurring_transaction_templates (company_id, customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX recurring_templates_vendor_idx ON public.recurring_transaction_templates (company_id, vendor_id) WHERE vendor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX recurring_schedules_due_idx ON public.recurring_transaction_schedules (company_id, next_run_date) WHERE next_run_date IS NOT NULL;
CREATE INDEX recurring_executions_template_idx ON public.recurring_transaction_executions (company_id, template_id, execution_date DESC);
CREATE INDEX recurring_attachments_template_idx ON public.recurring_transaction_attachments (company_id, template_id) WHERE deleted_at IS NULL;

CREATE TRIGGER recurring_templates_set_updated_at BEFORE UPDATE ON public.recurring_transaction_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER recurring_schedules_set_updated_at BEFORE UPDATE ON public.recurring_transaction_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recurring_transaction_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transaction_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transaction_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transaction_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_templates_select ON public.recurring_transaction_templates FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL);
CREATE POLICY recurring_templates_write ON public.recurring_transaction_templates FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]));
CREATE POLICY recurring_schedules_select ON public.recurring_transaction_schedules FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY recurring_schedules_write ON public.recurring_transaction_schedules FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]));
CREATE POLICY recurring_executions_select ON public.recurring_transaction_executions FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY recurring_executions_write ON public.recurring_transaction_executions FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]));
CREATE POLICY recurring_attachments_select ON public.recurring_transaction_attachments FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND deleted_at IS NULL);
CREATE POLICY recurring_attachments_write ON public.recurring_transaction_attachments FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()) AND public.user_has_company_role(company_id, ARRAY['OWNER','ADMIN','ACCOUNTANT','MANAGER']::public.company_role[]));

CREATE POLICY recurring_templates_service ON public.recurring_transaction_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recurring_schedules_service ON public.recurring_transaction_schedules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recurring_executions_service ON public.recurring_transaction_executions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY recurring_attachments_service ON public.recurring_transaction_attachments FOR ALL TO service_role USING (true) WITH CHECK (true);
