-- 038_performance_and_retention.sql
-- Additive only: performance indexes, BRIN indexes, retention metadata, archive shells

BEGIN;

-- ========== ACCOUNTING ==========
CREATE INDEX IF NOT EXISTS expenses_company_status_date_idx
  ON public.expenses (company_id, status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS fiscal_periods_company_status_idx
  ON public.fiscal_periods (company_id, status, period_start, period_end);

CREATE INDEX IF NOT EXISTS ledger_entries_trial_balance_sort_idx
  ON public.ledger_entries (company_id, entry_date, posting_sequence, posted_at);

-- ========== SALES ==========
CREATE INDEX IF NOT EXISTS invoices_company_status_idx
  ON public.invoices (company_id, status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoices_company_customer_idx
  ON public.invoices (company_id, customer_id, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoices_company_due_date_idx
  ON public.invoices (company_id, due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('PAID', 'VOID');

CREATE INDEX IF NOT EXISTS estimates_company_status_date_idx
  ON public.estimates (company_id, status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sales_orders_company_status_date_idx
  ON public.sales_orders (company_id, status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS estimate_lines_estimate_id_idx
  ON public.estimate_lines (estimate_id);

CREATE INDEX IF NOT EXISTS sales_order_lines_order_id_idx
  ON public.sales_order_lines (sales_order_id);

CREATE INDEX IF NOT EXISTS payments_company_date_idx
  ON public.payments (company_id, date DESC) WHERE deleted_at IS NULL;

-- ========== PURCHASES ==========
CREATE INDEX IF NOT EXISTS bills_company_vendor_date_idx
  ON public.bills (company_id, vendor_id, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bills_company_approval_status_idx
  ON public.bills (company_id, approval_status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bills_purchase_order_id_idx
  ON public.bills (purchase_order_id) WHERE purchase_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchase_orders_company_status_date_idx
  ON public.purchase_orders (company_id, status, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS purchase_orders_vendor_id_idx
  ON public.purchase_orders (vendor_id);

CREATE INDEX IF NOT EXISTS purchase_order_lines_po_id_idx
  ON public.purchase_order_lines (purchase_order_id);

CREATE INDEX IF NOT EXISTS vendor_credits_company_status_idx
  ON public.vendor_credits (company_id, status, date DESC) WHERE deleted_at IS NULL;

-- ========== INVENTORY ==========
CREATE INDEX IF NOT EXISTS warehouse_stock_item_idx
  ON public.warehouse_stock (company_id, inventory_item_id);

CREATE INDEX IF NOT EXISTS warehouse_stock_warehouse_idx
  ON public.warehouse_stock (company_id, warehouse_id);

CREATE INDEX IF NOT EXISTS inventory_cost_layers_fifo_idx
  ON public.inventory_cost_layers (company_id, inventory_item_id, warehouse_id, received_at ASC)
  WHERE quantity_remaining > 0;

CREATE INDEX IF NOT EXISTS inventory_reservations_active_idx
  ON public.inventory_reservations (company_id, status, expires_at) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS stock_count_sessions_status_idx
  ON public.stock_count_sessions (company_id, status, count_date DESC);

CREATE INDEX IF NOT EXISTS stock_count_lines_session_idx
  ON public.stock_count_lines (session_id);

CREATE INDEX IF NOT EXISTS inventory_items_company_active_idx
  ON public.inventory_items (company_id, is_active) WHERE deleted_at IS NULL;

-- ========== BANKING ==========
CREATE INDEX IF NOT EXISTS bank_transactions_account_date_idx
  ON public.bank_transactions (company_id, bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS bank_transactions_status_idx
  ON public.bank_transactions (company_id, status, transaction_date DESC);

CREATE INDEX IF NOT EXISTS bank_reconciliations_account_idx
  ON public.bank_reconciliations (company_id, bank_account_id, statement_date DESC);

CREATE INDEX IF NOT EXISTS cheques_company_status_idx
  ON public.cheques (company_id, status, issue_date DESC);

-- ========== PAYROLL ==========
CREATE INDEX IF NOT EXISTS payroll_entries_company_status_idx
  ON public.payroll_entries (company_id, status, period_start DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_records_company_date_idx
  ON public.attendance_records (company_id, date DESC);

CREATE INDEX IF NOT EXISTS expense_claims_company_status_idx
  ON public.expense_claims (company_id, status, date DESC);

-- ========== WORKFLOW ==========
CREATE INDEX IF NOT EXISTS workflow_instances_status_idx
  ON public.workflow_instances (company_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS workflow_tasks_pending_due_idx
  ON public.workflow_tasks (company_id, status, due_at) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS workflow_history_company_created_idx
  ON public.workflow_history (company_id, created_at DESC);

-- ========== REPORTING ==========
CREATE INDEX IF NOT EXISTS report_schedules_next_run_idx
  ON public.report_schedules (company_id, next_run_at) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS report_permissions_user_idx
  ON public.report_permissions (company_id, user_id, report_key);

-- ========== PLATFORM ==========
CREATE INDEX IF NOT EXISTS job_history_company_created_idx
  ON public.job_history (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_queue_company_status_idx
  ON public.job_queue (company_id, status, scheduled_at) WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS webhook_deliveries_company_status_idx
  ON public.webhook_deliveries (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS search_recent_user_idx
  ON public.search_recent (company_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS zatca_api_logs_created_brin
  ON public.zatca_api_logs USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS api_usage_logs_created_brin
  ON public.api_usage_logs USING BRIN (created_at);

-- ========== RETENTION METADATA ==========
CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  retain_days INT NOT NULL DEFAULT 2555,
  archive_before_delete BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, table_name)
);

CREATE TABLE IF NOT EXISTS public.audit_logs_archive
  (LIKE public.audit_logs INCLUDING ALL);

CREATE TABLE IF NOT EXISTS public.job_history_archive
  (LIKE public.job_history INCLUDING ALL);

CREATE TABLE IF NOT EXISTS public.ledger_entries_archive
  (LIKE public.ledger_entries INCLUDING ALL);

CREATE INDEX IF NOT EXISTS audit_logs_archive_company_created_idx
  ON public.audit_logs_archive (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_history_archive_created_idx
  ON public.job_history_archive (created_at DESC);

ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY data_retention_policies_tenant ON public.data_retention_policies
  FOR ALL USING (company_id IS NULL OR company_id IN (SELECT public.user_company_ids()));

COMMIT;
