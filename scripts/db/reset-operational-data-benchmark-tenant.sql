-- =============================================================================
-- Single-tenant accounting / migration operational data reset
-- Target: QuickBooks-connected benchmark company only
-- =============================================================================
-- COMPANY (only tenant touched):
--   00000000-0000-4000-8000-000000000001  (slug: netkom, realm 9341457612363747)
--
-- PRESERVE for this company:
--   companies row, company_settings, subscriptions, ZATCA settings/credentials,
--   company_users, profiles, company_currencies, currency_settings (FKs nulled),
--   tax_rates / tax_groups / tax_group_rates, payment_terms / payment_methods,
--   warehouses, units_of_measure, document_sequences / sequences / numbering_series
--   (counters reset), feature flags, accounting_integration_connections (OAuth).
--
-- DELETE for this company only:
--   All accounting masters, transactions, inventory, migration artifacts,
--   import_jobs, job_queue rows, wizard sessions, QuickBooks staging/checkpoints.
--
-- OTHER COMPANIES:
--   Operational data untouched except minimal cross-tenant FK repair (section 4a)
--   when foreign rows incorrectly reference benchmark customers/vendors.
--
-- SAFETY: single transaction, idempotent for the target tenant, rolls back on failure.
-- RUN AS: postgres / service_role in Supabase SQL editor or psql.
-- IMPORTANT: Execute this whole file as one query (single DO block).
-- =============================================================================


DO $reset$
DECLARE
  v_target uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_id uuid;
  v_slug text;
  v_oauth boolean;
  v_detached bigint := 0;
  v_row bigint;
  v_fail text[] := ARRAY[]::text[];
  v_before bigint;
  v_after bigint;
  v_entity text;
  v_tbl text;
  v_count bigint;
  v_tables text[] := ARRAY[
    'customers','vendors','chart_of_accounts','cost_centers','exchange_rates',
    'inventory_items','warehouse_stock','stock_movements','invoices','invoice_lines',
    'bills','bill_lines','payments','payment_allocations','expenses','expense_lines',
    'estimates','estimate_lines','purchase_orders','purchase_order_lines',
    'journal_entries','journal_lines','ledger_entries','bank_accounts','bank_transactions',
    'sales_receipts','sales_receipt_lines','vendor_credits','vendor_credit_lines',
    'vendor_credit_applications','deposit_allocations','employees','fixed_assets',
    'import_jobs','import_job_errors','import_job_skips','import_mapping_templates',
    'migration_wizard_sessions',
    'quickbooks_migration_records','quickbooks_migration_local_links',
    'quickbooks_migration_checkpoints','quickbooks_migration_warnings',
    'quickbooks_materialization_runs','quickbooks_extraction_staging',
    'quickbooks_certification_runs','quickbooks_certification_sections',
    'quickbooks_cutoff_reconciliations','quickbooks_opening_balance_details',
    'quickbooks_retained_earnings_periods',
    'accounting_sync_runs','accounting_sync_changes',
    'tax_agencies','tax_filing_periods','tax_settlements'
  ];
  v_table text;
BEGIN
  SET LOCAL lock_timeout = '30s';
  SET LOCAL statement_timeout = '30min';

  -- 0. Pre-flight
  v_id := v_target;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_id) THEN
    RAISE EXCEPTION 'Abort: target company % does not exist', v_id;
  END IF;
  SELECT slug INTO v_slug FROM public.companies WHERE id = v_id;
  SELECT EXISTS (
    SELECT 1
    FROM public.accounting_integration_connections c
    JOIN public.accounting_integration_providers p ON p.id = c.provider_id
    WHERE c.tenant_id = v_id
      AND p.slug = 'quickbooks'
      AND c.status = 'CONNECTED'
  ) INTO v_oauth;
  IF NOT v_oauth THEN
    RAISE EXCEPTION 'Abort: target company % (%) has no CONNECTED QuickBooks OAuth row', v_id, v_slug;
  END IF;

  -- Snapshots (session-local temp tables; live for this DO block only)
  CREATE TEMP TABLE _global_preserve_before AS
SELECT 'companies'::text AS entity, count(*)::bigint AS n FROM public.companies
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'accounting_integration_providers', count(*) FROM public.accounting_integration_providers
UNION ALL SELECT 'accounting_integration_connections', count(*) FROM public.accounting_integration_connections
UNION ALL SELECT 'feature_flags', count(*) FROM public.feature_flags
UNION ALL SELECT 'integration_connectors', count(*) FROM public.integration_connectors;

CREATE TEMP TABLE _target_preserve_before AS
SELECT 'company_users'::text AS entity, count(*)::bigint AS n
FROM public.company_users WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'company_settings', count(*)
FROM public.company_settings WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'company_subscriptions', count(*)
FROM public.company_subscriptions WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'company_zatca_settings', count(*)
FROM public.company_zatca_settings WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'zatca_credentials', count(*)
FROM public.zatca_credentials WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'company_currencies', count(*)
FROM public.company_currencies WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'currency_settings', count(*)
FROM public.currency_settings WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'tax_rates', count(*)
FROM public.tax_rates WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'tax_groups', count(*)
FROM public.tax_groups WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'tax_group_rates', count(*)
FROM public.tax_group_rates WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'payment_terms', count(*)
FROM public.payment_terms WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'payment_methods', count(*)
FROM public.payment_methods WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'warehouses', count(*)
FROM public.warehouses WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'units_of_measure', count(*)
FROM public.units_of_measure WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'document_sequences', count(*)
FROM public.document_sequences WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'sequences', count(*)
FROM public.sequences WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'qb_oauth_connections', count(*)
FROM public.accounting_integration_connections
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'::uuid AND status = 'CONNECTED';

CREATE TEMP TABLE _other_ops_before AS
SELECT 'customers'::text AS tbl, count(*)::bigint AS n
FROM public.customers WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'vendors', count(*) FROM public.vendors WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'chart_of_accounts', count(*) FROM public.chart_of_accounts WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'invoices', count(*) FROM public.invoices WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'import_jobs', count(*) FROM public.import_jobs WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'quickbooks_migration_records', count(*) FROM public.quickbooks_migration_records WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'job_queue', count(*) FROM public.job_queue WHERE company_id IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL SELECT 'migration_wizard_sessions', count(*) FROM public.migration_wizard_sessions WHERE company_id <> '00000000-0000-4000-8000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- 1. Null preserved-config FKs → COA (target company only)
-- ---------------------------------------------------------------------------
UPDATE public.currency_settings
SET
  realized_gain_account_id = NULL,
  realized_loss_account_id = NULL,
  unrealized_gain_account_id = NULL,
  unrealized_loss_account_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND (
    realized_gain_account_id IS NOT NULL
    OR realized_loss_account_id IS NOT NULL
    OR unrealized_gain_account_id IS NOT NULL
    OR unrealized_loss_account_id IS NOT NULL
  );

UPDATE public.tax_rates
SET gl_account_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND gl_account_id IS NOT NULL;

UPDATE public.payment_methods
SET clearing_account_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND clearing_account_id IS NOT NULL;

UPDATE public.expense_categories
SET account_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND account_id IS NOT NULL;

UPDATE public.inventory_items
SET
  inventory_asset_account_id = NULL,
  cogs_account_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND (
    inventory_asset_account_id IS NOT NULL
    OR cogs_account_id IS NOT NULL
  );

DELETE FROM public.tax_settlements
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.tax_filing_periods
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.tax_agencies
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.tax_exemptions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- 2. migration_id_map (no company_id — delete only this tenant's entity UUIDs)
-- ---------------------------------------------------------------------------
DELETE FROM public.migration_id_map m
WHERE m.supabase_id IN (
  SELECT id FROM public.customers WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.vendors WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.chart_of_accounts WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.cost_centers WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.inventory_items WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.invoices WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.bills WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  UNION SELECT id FROM public.employees WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
);

-- ---------------------------------------------------------------------------
-- 3. Migration / import / queue artifacts (target only)
-- ---------------------------------------------------------------------------
DELETE FROM public.import_job_skips
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.import_job_errors
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.import_jobs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.import_mapping_templates
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.job_history
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
   OR job_id IN (
     SELECT id FROM public.job_queue
     WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
        OR payload->>'companyId' = '00000000-0000-4000-8000-000000000001'::text
        OR payload->>'company_id' = '00000000-0000-4000-8000-000000000001'::text
   );

DELETE FROM public.dead_letter_queue
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.job_queue
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
   OR payload->>'companyId' = '00000000-0000-4000-8000-000000000001'::text
   OR payload->>'company_id' = '00000000-0000-4000-8000-000000000001'::text;

IF to_regclass('public.job_history_archive') IS NOT NULL THEN
    DELETE FROM public.job_history_archive
    WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;
  END IF;

DELETE FROM public.quickbooks_extraction_staging
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_migration_warnings
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_migration_local_links
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_migration_records
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_migration_checkpoints
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_materialization_runs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- quickbooks_webhook_events has no company_id; rows are keyed by realm_id only.
-- Both sandbox tenants share realm 9341457612363747, so deleting by realm would
-- touch other companies. Leave webhook queue rows unchanged.

DELETE FROM public.quickbooks_opening_balance_details
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_cutoff_reconciliations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_retained_earnings_periods
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_certification_sections
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.quickbooks_certification_runs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.migration_wizard_sessions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.accounting_sync_changes
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.accounting_sync_runs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.accounting_integration_logs
WHERE connection_id IN (
  SELECT id FROM public.accounting_integration_connections
  WHERE tenant_id = '00000000-0000-4000-8000-000000000001'::uuid
);

-- ---------------------------------------------------------------------------
-- 4. Transactional / posting leaves (target only)
-- ---------------------------------------------------------------------------
DELETE FROM public.payment_allocations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.deposit_allocations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.deposit_audit_log
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bank_reconciliation_items
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.vendor_credit_applications
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.billable_charge_links
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoice_attachments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoice_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bill_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.expense_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.estimate_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_order_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_receipt_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.purchase_order_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.refund_receipt_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.vendor_credit_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.journal_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.payroll_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.budget_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.fx_revaluation_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.stock_count_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.ledger_entries
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

IF to_regclass('public.ledger_entries_archive') IS NOT NULL THEN
    DELETE FROM public.ledger_entries_archive
    WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;
  END IF;

UPDATE public.invoices
SET referenced_invoice_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND referenced_invoice_id IS NOT NULL;

-- Credit notes in other tenants may reference our invoice ids (RESTRICT).
UPDATE public.invoices
SET referenced_invoice_id = NULL
WHERE referenced_invoice_id IN (
  SELECT id FROM public.invoices WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
);

DELETE FROM public.refund_receipts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.credit_card_payments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.time_activities
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_invoice_schedules
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_transaction_attachments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_transaction_executions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_transaction_schedules
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_transaction_templates
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.recurring_expenses
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- ZATCA rows must be removed BEFORE invoices. Composite FKs
-- zatca_audit_logs / zatca_api_logs → invoices use ON DELETE SET NULL on
-- (company_id, invoice_id). company_id is NOT NULL, so invoice deletes fail
-- unless these children are gone first. xml_archive is CASCADE but cleared here
-- for a deterministic order.
DELETE FROM public.zatca_xml_archive
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.zatca_api_logs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.zatca_audit_logs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.zatca_sandbox_test_runs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- Customer-linked sales documents must be removed before invoices/customers
-- (customer_id uses ON DELETE RESTRICT on estimates & sales_orders).
DELETE FROM public.estimate_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.estimates
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_order_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_orders
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.payments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoices
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bills
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.expenses
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_receipts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.purchase_orders
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.vendor_credits
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.receipts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.cheques
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bank_transfers
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bank_reconciliations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bank_transactions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bank_accounts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.fx_revaluations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.fiscal_year_closings
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.journal_entries
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.fiscal_periods
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.payroll_entries
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.salary_components
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.salary_structures
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.attendance_records
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.employee_loans
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.employee_advances
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.expense_claims
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.employees
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_reservations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_serials
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_lots
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_cost_layers
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_audit_logs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.warehouse_stock
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.stock_count_sessions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.stock_movements
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.inventory_items
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.budgets
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.fixed_assets
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.custom_field_values cfv
USING public.custom_field_definitions cfd
WHERE cfv.definition_id = cfd.id
  AND cfd.company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.document_tag_assignments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.document_relationships
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.document_ocr_metadata
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.document_comments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.document_versions
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.documents
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.workflow_notifications
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.workflow_history
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.workflow_tasks
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.workflow_delegations
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.workflow_instances
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.automation_runs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.webhook_deliveries
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.api_usage_logs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.platform_notifications
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.notification_delivery_log
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.search_recent
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.report_daily_summaries
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.report_schedules
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.audit_logs
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

IF to_regclass('public.audit_logs_archive') IS NOT NULL THEN
    DELETE FROM public.audit_logs_archive
    WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;
  END IF;

-- ---------------------------------------------------------------------------
-- 4a. Detach cross-tenant customer references
-- ---------------------------------------------------------------------------
  INSERT INTO public.customers (company_id, customer_no, name)
  SELECT DISTINCT x.company_id,
    'SYS-DETACH-' || replace(substr(x.company_id::text, 1, 8), '-', ''),
    '[System] Detached benchmark customer reference'
  FROM (
    SELECT i.company_id
    FROM public.invoices i
    JOIN public.customers c ON c.id = i.customer_id
    WHERE c.company_id = v_target AND i.company_id <> v_target
    UNION
    SELECT e.company_id
    FROM public.estimates e
    JOIN public.customers c ON c.id = e.customer_id
    WHERE c.company_id = v_target AND e.company_id <> v_target
    UNION
    SELECT so.company_id
    FROM public.sales_orders so
    JOIN public.customers c ON c.id = so.customer_id
    WHERE c.company_id = v_target AND so.company_id <> v_target
    UNION
    SELECT rr.company_id
    FROM public.refund_receipts rr
    JOIN public.customers c ON c.id = rr.customer_id
    WHERE c.company_id = v_target AND rr.company_id <> v_target
  ) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customers c2 WHERE c2.company_id = x.company_id
  )
  ON CONFLICT (company_id, customer_no) DO NOTHING;

  UPDATE public.invoices i
  SET customer_id = (
    SELECT c2.id
    FROM public.customers c2
    WHERE c2.company_id = i.company_id
    ORDER BY c2.created_at
    LIMIT 1
  )
  FROM public.customers c
  WHERE i.customer_id = c.id
    AND c.company_id = v_target
    AND i.company_id <> v_target;
  GET DIAGNOSTICS v_row = ROW_COUNT;
  v_detached := v_detached + v_row;

  UPDATE public.estimates e
  SET customer_id = (
    SELECT c2.id
    FROM public.customers c2
    WHERE c2.company_id = e.company_id
    ORDER BY c2.created_at
    LIMIT 1
  )
  FROM public.customers c
  WHERE e.customer_id = c.id
    AND c.company_id = v_target
    AND e.company_id <> v_target;
  GET DIAGNOSTICS v_row = ROW_COUNT;
  v_detached := v_detached + v_row;

  UPDATE public.sales_orders so
  SET customer_id = (
    SELECT c2.id
    FROM public.customers c2
    WHERE c2.company_id = so.company_id
    ORDER BY c2.created_at
    LIMIT 1
  )
  FROM public.customers c
  WHERE so.customer_id = c.id
    AND c.company_id = v_target
    AND so.company_id <> v_target;
  GET DIAGNOSTICS v_row = ROW_COUNT;
  v_detached := v_detached + v_row;

  UPDATE public.refund_receipts rr
  SET customer_id = (
    SELECT c2.id
    FROM public.customers c2
    WHERE c2.company_id = rr.company_id
    ORDER BY c2.created_at
    LIMIT 1
  )
  FROM public.customers c
  WHERE rr.customer_id = c.id
    AND c.company_id = v_target
    AND rr.company_id <> v_target;
  GET DIAGNOSTICS v_row = ROW_COUNT;
  v_detached := v_detached + v_row;

  UPDATE public.expenses e
  SET customer_id = NULL
  FROM public.customers c
  WHERE e.customer_id = c.id
    AND c.company_id = v_target
    AND e.company_id <> v_target;

  UPDATE public.time_activities ta
  SET customer_id = NULL
  FROM public.customers c
  WHERE ta.customer_id = c.id
    AND c.company_id = v_target
    AND ta.company_id <> v_target;

  UPDATE public.sales_receipts sr
  SET customer_id = NULL
  FROM public.customers c
  WHERE sr.customer_id = c.id
    AND c.company_id = v_target
    AND sr.company_id <> v_target;

  IF EXISTS (
    SELECT 1
    FROM public.invoices i
    JOIN public.customers c ON c.id = i.customer_id
    WHERE c.company_id = v_target
      AND i.company_id <> v_target
  ) THEN
    RAISE EXCEPTION
      'Cross-tenant customer detach incomplete: invoices still reference benchmark customers';
  END IF;

  IF v_detached > 0 THEN
    RAISE NOTICE 'Detached % cross-tenant row(s) from benchmark customers', v_detached;
  END IF;


-- ---------------------------------------------------------------------------
-- 4b. Safety pass — ensure AR/AP documents are gone before masters
-- ---------------------------------------------------------------------------
UPDATE public.invoices
SET referenced_invoice_id = NULL
WHERE referenced_invoice_id IN (
  SELECT id FROM public.invoices WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
);

DELETE FROM public.estimate_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.estimates
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_order_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.sales_orders
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.refund_receipts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoice_attachments
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoice_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.invoices
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.purchase_order_lines
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.purchase_orders
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.bills
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- 5. Masters (target only)
-- ---------------------------------------------------------------------------
DELETE FROM public.customers
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.vendors
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.exchange_rates
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

DELETE FROM public.cost_centers
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

UPDATE public.chart_of_accounts
SET parent_id = NULL
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND parent_id IS NOT NULL;

DELETE FROM public.chart_of_accounts
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- 6. Reset numbering / posting counters (target only; rows preserved)
-- ---------------------------------------------------------------------------
UPDATE public.document_sequences
SET next_number = starting_number,
    updated_at = now()
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND next_number <> starting_number;

UPDATE public.sequences
SET next_no = 1
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND next_no <> 1;

UPDATE public.posting_sequences
SET last_sequence = 0,
    updated_at = now()
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND last_sequence <> 0;

UPDATE public.numbering_series
SET next_number = 1
WHERE company_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND next_number <> 1;

-- ---------------------------------------------------------------------------
-- 7. Verification
-- ---------------------------------------------------------------------------
-- Global preserve
  FOREACH v_entity IN ARRAY ARRAY[
    'companies','profiles','accounting_integration_providers',
    'accounting_integration_connections','feature_flags','integration_connectors'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_entity) INTO v_after;
    SELECT n INTO v_before FROM _global_preserve_before WHERE entity = v_entity;
    IF v_before IS DISTINCT FROM v_after THEN
      v_fail := array_append(v_fail, format('global preserve drift %s: %s -> %s', v_entity, v_before, v_after));
    END IF;
  END LOOP;

  -- Target preserve
  FOREACH v_entity IN ARRAY ARRAY[
    'company_users','company_settings','company_subscriptions','company_zatca_settings',
    'zatca_credentials','company_currencies','currency_settings','tax_rates','tax_groups',
    'tax_group_rates','payment_terms','payment_methods','warehouses','units_of_measure',
    'document_sequences','sequences','qb_oauth_connections'
  ] LOOP
    IF v_entity = 'qb_oauth_connections' THEN
      SELECT count(*) INTO v_after
      FROM public.accounting_integration_connections
      WHERE tenant_id = v_target AND status = 'CONNECTED';
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_entity) INTO v_after USING v_target;
    END IF;
    SELECT n INTO v_before FROM _target_preserve_before WHERE entity = v_entity;
    IF v_before IS DISTINCT FROM v_after THEN
      v_fail := array_append(v_fail, format('target preserve drift %s: %s -> %s', v_entity, v_before, v_after));
    END IF;
  END LOOP;

  -- Other companies untouched
  FOREACH v_tbl IN ARRAY ARRAY[
    'customers','vendors','chart_of_accounts','invoices','import_jobs',
    'quickbooks_migration_records','job_queue','migration_wizard_sessions'
  ] LOOP
    IF v_tbl = 'job_queue' THEN
      EXECUTE 'SELECT count(*) FROM public.job_queue WHERE company_id IS DISTINCT FROM $1' INTO v_after USING v_target;
      SELECT n INTO v_before FROM _other_ops_before WHERE tbl = v_tbl;
    ELSIF v_tbl = 'customers' THEN
      -- Section 4a may insert one SYS-DETACH placeholder per affected tenant.
      EXECUTE $sql$
        SELECT count(*) FROM public.customers
        WHERE company_id <> $1
          AND customer_no NOT LIKE 'SYS-DETACH-%'
      $sql$ INTO v_after USING v_target;
      SELECT count(*) INTO v_before
      FROM public.customers
      WHERE company_id <> v_target
        AND customer_no NOT LIKE 'SYS-DETACH-%';
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id <> $1', v_tbl) INTO v_after USING v_target;
      SELECT n INTO v_before FROM _other_ops_before WHERE tbl = v_tbl;
    END IF;
    IF v_before IS DISTINCT FROM v_after THEN
      v_fail := array_append(v_fail, format('other-company drift %s: %s -> %s', v_tbl, v_before, v_after));
    END IF;
  END LOOP;

  -- Target operational tables empty
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_table) INTO v_count USING v_target;
    IF v_count > 0 THEN
      v_fail := array_append(v_fail, format('target %s still has %s rows', v_table, v_count));
    END IF;
  END LOOP;

  -- Target queue rows
  EXECUTE $sql$
    SELECT count(*) FROM public.job_queue
    WHERE company_id = $1
       OR payload->>'companyId' = $1::text
       OR payload->>'company_id' = $1::text
  $sql$ INTO v_count USING v_target;
  IF v_count > 0 THEN
    v_fail := array_append(v_fail, format('target job_queue still has %s rows', v_count));
  END IF;

  EXECUTE $sql$
    SELECT count(*) FROM public.job_history
    WHERE company_id = $1
       OR job_id IN (
         SELECT id FROM public.job_queue
         WHERE company_id = $1
            OR payload->>'companyId' = $1::text
            OR payload->>'company_id' = $1::text
       )
  $sql$ INTO v_count USING v_target;
  IF v_count > 0 THEN
    v_fail := array_append(v_fail, format('target job_history still has %s rows', v_count));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.document_sequences
    WHERE company_id = v_target AND next_number <> starting_number
  ) THEN
    v_fail := array_append(v_fail, 'target document_sequences counters not reset');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.currency_settings
    WHERE company_id = v_target
      AND (
        realized_gain_account_id IS NOT NULL
        OR realized_loss_account_id IS NOT NULL
        OR unrealized_gain_account_id IS NOT NULL
        OR unrealized_loss_account_id IS NOT NULL
      )
  ) THEN
    v_fail := array_append(v_fail, 'target currency_settings still references COA');
  END IF;

  IF array_length(v_fail, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Benchmark tenant reset failed: %', array_to_string(v_fail, '; ');
  END IF;

  RAISE NOTICE 'Benchmark tenant reset OK for %. OAuth preserved. Other companies unchanged. Target operational tables empty.',
    v_target;
END;
$reset$;


-- Post-commit spot checks (read-only)
-- SELECT slug, company_name FROM public.companies WHERE id = '00000000-0000-4000-8000-000000000001';
-- SELECT tenant_id, status, realm_id FROM public.accounting_integration_connections WHERE tenant_id = '00000000-0000-4000-8000-000000000001';
-- SELECT count(*) FROM public.customers WHERE company_id = '00000000-0000-4000-8000-000000000001';
-- SELECT count(*) FROM public.customers WHERE company_id = '05585a44-672d-4bab-aa40-6dfe022c19a0';
-- SELECT count(*) FROM public.import_jobs WHERE company_id = '00000000-0000-4000-8000-000000000001';