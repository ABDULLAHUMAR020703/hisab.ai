-- =============================================================================
-- Full accounting / migration operational data reset
-- Generated: 2026-08-06 (audit against live Supabase project)
-- =============================================================================
-- INTENT
--   Delete ALL accounting and migration operational data across ALL companies.
--   Preserve tenants, auth, memberships, OAuth connections, and configuration
--   so every company behaves like a brand-new empty tenant.
--
-- TARGET BENCHMARK TENANT (must remain, emptied of business data):
--   05585a44-672d-4bab-aa40-6dfe022c19a0
--
-- CRITICAL PRE-FLIGHT FINDING
--   That company currently has ZERO rows in
--   accounting_integration_connections. Connected QuickBooks OAuth rows exist
--   only for:
--     00000000-0000-4000-8000-000000000001  (CONNECTED, realm 9341457612363747)
--     f5b2a58b-0bd6-4a46-819d-d45a01ec06ca  (CONNECTED, realm 9341457612363747)
--   This script preserves every OAuth row that exists. It cannot invent a
--   connection for 05585a44…. Connect QuickBooks to that tenant AFTER cleanup
--   before running a fresh migration benchmark.
--
-- SAFETY
--   - Single transaction: any failure rolls everything back.
--   - Idempotent: re-running deletes 0 rows and still passes verification.
--   - No DDL / no schema changes.
--   - Does NOT delete companies, profiles, company_users, auth.users,
--     subscriptions, settings, currencies, tax rates/groups, document
--     sequence ROWS (counters are reset), feature flags, or OAuth connections.
--
-- HOW TO RUN (Supabase SQL editor or psql as a role that bypasses RLS /
-- service_role / postgres):
--   1. Review this file and the companion audit.
--   2. Execute the entire script in one session.
--   3. Confirm the verification NOTICE output shows all zeros / preserved counts.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '30min';

-- ---------------------------------------------------------------------------
-- 0. Snapshot preserve counts (must not change)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _reset_preserve_before ON COMMIT DROP AS
SELECT 'companies'::text AS entity, count(*)::bigint AS n FROM public.companies
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'company_users', count(*) FROM public.company_users
UNION ALL SELECT 'company_settings', count(*) FROM public.company_settings
UNION ALL SELECT 'company_subscriptions', count(*) FROM public.company_subscriptions
UNION ALL SELECT 'company_zatca_settings', count(*) FROM public.company_zatca_settings
UNION ALL SELECT 'zatca_credentials', count(*) FROM public.zatca_credentials
UNION ALL SELECT 'accounting_integration_providers', count(*) FROM public.accounting_integration_providers
UNION ALL SELECT 'accounting_integration_connections', count(*) FROM public.accounting_integration_connections
UNION ALL SELECT 'accounting_integration_oauth_states', count(*) FROM public.accounting_integration_oauth_states
UNION ALL SELECT 'company_currencies', count(*) FROM public.company_currencies
UNION ALL SELECT 'currency_settings', count(*) FROM public.currency_settings
UNION ALL SELECT 'tax_rates', count(*) FROM public.tax_rates
UNION ALL SELECT 'tax_groups', count(*) FROM public.tax_groups
UNION ALL SELECT 'tax_group_rates', count(*) FROM public.tax_group_rates
UNION ALL SELECT 'document_sequences', count(*) FROM public.document_sequences
UNION ALL SELECT 'sequences', count(*) FROM public.sequences
UNION ALL SELECT 'feature_flags', count(*) FROM public.feature_flags
UNION ALL SELECT 'payment_terms', count(*) FROM public.payment_terms
UNION ALL SELECT 'payment_methods', count(*) FROM public.payment_methods
UNION ALL SELECT 'warehouses', count(*) FROM public.warehouses
UNION ALL SELECT 'units_of_measure', count(*) FROM public.units_of_measure;

DO $$
DECLARE
  v_companies bigint;
  v_target boolean;
BEGIN
  SELECT n INTO v_companies FROM _reset_preserve_before WHERE entity = 'companies';
  IF v_companies < 1 THEN
    RAISE EXCEPTION 'Abort: companies table is empty — refusing to run reset';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.companies WHERE id = '05585a44-672d-4bab-aa40-6dfe022c19a0'
  ) INTO v_target;

  IF NOT v_target THEN
    RAISE EXCEPTION 'Abort: benchmark company 05585a44-672d-4bab-aa40-6dfe022c19a0 is missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Break preserved-config FKs that point at operational GL / masters
--    (nullable ON DELETE SET NULL columns still block deletes while populated
--     if any RESTRICT edges remain elsewhere; clear them explicitly.)
-- ---------------------------------------------------------------------------
UPDATE public.currency_settings
SET
  realized_gain_account_id = NULL,
  realized_loss_account_id = NULL,
  unrealized_gain_account_id = NULL,
  unrealized_loss_account_id = NULL
WHERE realized_gain_account_id IS NOT NULL
   OR realized_loss_account_id IS NOT NULL
   OR unrealized_gain_account_id IS NOT NULL
   OR unrealized_loss_account_id IS NOT NULL;

UPDATE public.tax_rates
SET gl_account_id = NULL
WHERE gl_account_id IS NOT NULL;

UPDATE public.payment_methods
SET clearing_account_id = NULL
WHERE clearing_account_id IS NOT NULL;

UPDATE public.expense_categories
SET account_id = NULL
WHERE account_id IS NOT NULL;

UPDATE public.inventory_items
SET
  inventory_asset_account_id = NULL,
  cogs_account_id = NULL
WHERE inventory_asset_account_id IS NOT NULL
   OR cogs_account_id IS NOT NULL;

-- tax_agencies.liability_account_id is NOT NULL + ON DELETE RESTRICT.
-- Keeping agencies would force keeping COA rows. Delete agencies (QB-imported
-- tax setup) so chart_of_accounts can be fully cleared. tax_rates / tax_groups
-- remain as product tax configuration.
DELETE FROM public.tax_settlements;
DELETE FROM public.tax_filing_periods;
DELETE FROM public.tax_agencies;

-- ---------------------------------------------------------------------------
-- 2. Migration / import / queue artifacts (leaf → parent)
-- ---------------------------------------------------------------------------
DELETE FROM public.import_job_skips;
DELETE FROM public.import_job_errors;
DELETE FROM public.import_jobs;
DELETE FROM public.import_mapping_templates;

DELETE FROM public.job_history;
DELETE FROM public.dead_letter_queue;
DELETE FROM public.job_queue;
DO $$ BEGIN
  IF to_regclass('public.job_history_archive') IS NOT NULL THEN
    DELETE FROM public.job_history_archive;
  END IF;
END $$;

DELETE FROM public.quickbooks_extraction_staging;
DELETE FROM public.quickbooks_migration_warnings;
DELETE FROM public.quickbooks_migration_local_links;
DELETE FROM public.quickbooks_migration_records;
DELETE FROM public.quickbooks_migration_checkpoints;
DELETE FROM public.quickbooks_materialization_runs;
DELETE FROM public.quickbooks_webhook_events;
DELETE FROM public.quickbooks_opening_balance_details;
DELETE FROM public.quickbooks_cutoff_reconciliations;
DELETE FROM public.quickbooks_retained_earnings_periods;
DELETE FROM public.quickbooks_certification_sections;
DELETE FROM public.quickbooks_certification_runs;

DELETE FROM public.migration_wizard_sessions;
DELETE FROM public.migration_id_map;

DELETE FROM public.accounting_sync_changes;
DELETE FROM public.accounting_sync_runs;
DELETE FROM public.accounting_integration_logs;

-- ---------------------------------------------------------------------------
-- 3. Transactional / posting leaves that RESTRICT parents
-- ---------------------------------------------------------------------------
DELETE FROM public.payment_allocations;
DELETE FROM public.deposit_allocations;
DELETE FROM public.deposit_audit_log;
DELETE FROM public.bank_reconciliation_items;
DELETE FROM public.vendor_credit_applications;
DELETE FROM public.billable_charge_links;

DELETE FROM public.invoice_attachments;
DELETE FROM public.invoice_lines;
DELETE FROM public.bill_lines;
DELETE FROM public.expense_lines;
DELETE FROM public.estimate_lines;
DELETE FROM public.sales_order_lines;
DELETE FROM public.sales_receipt_lines;
DELETE FROM public.purchase_order_lines;
DELETE FROM public.refund_receipt_lines;
DELETE FROM public.vendor_credit_lines;
DELETE FROM public.journal_lines;
DELETE FROM public.payroll_lines;
DELETE FROM public.budget_lines;
DELETE FROM public.fx_revaluation_lines;
DELETE FROM public.stock_count_lines;

DELETE FROM public.ledger_entries;
DO $$ BEGIN
  IF to_regclass('public.ledger_entries_archive') IS NOT NULL THEN
    DELETE FROM public.ledger_entries_archive;
  END IF;
END $$;

-- Self-referential invoice adjustments
UPDATE public.invoices SET referenced_invoice_id = NULL WHERE referenced_invoice_id IS NOT NULL;

DELETE FROM public.refund_receipts;
DELETE FROM public.credit_card_payments;
DELETE FROM public.time_activities;
DELETE FROM public.recurring_invoice_schedules;
DELETE FROM public.recurring_transaction_attachments;
DELETE FROM public.recurring_transaction_executions;
DELETE FROM public.recurring_transaction_schedules;
DELETE FROM public.recurring_transaction_templates;
DELETE FROM public.recurring_expenses;

-- ZATCA rows before invoices: composite FKs use ON DELETE SET NULL on
-- (company_id, invoice_id) while company_id is NOT NULL.
DELETE FROM public.zatca_xml_archive;
DELETE FROM public.zatca_api_logs;
DELETE FROM public.zatca_audit_logs;
DELETE FROM public.zatca_sandbox_test_runs;

DELETE FROM public.payments;
DELETE FROM public.invoices;
DELETE FROM public.bills;
DELETE FROM public.expenses;
DELETE FROM public.estimates;
DELETE FROM public.sales_orders;
DELETE FROM public.sales_receipts;
DELETE FROM public.purchase_orders;
DELETE FROM public.vendor_credits;
DELETE FROM public.receipts;
DELETE FROM public.cheques;
DELETE FROM public.bank_transfers;
DELETE FROM public.bank_reconciliations;
DELETE FROM public.bank_transactions;
DELETE FROM public.bank_accounts;

DELETE FROM public.fx_revaluations;
DELETE FROM public.fiscal_year_closings;
DELETE FROM public.journal_entries;
DELETE FROM public.fiscal_periods;

DELETE FROM public.payroll_entries;
DELETE FROM public.salary_components;
DELETE FROM public.salary_structures;
DELETE FROM public.attendance_records;
DELETE FROM public.employee_loans;
DELETE FROM public.employee_advances;
DELETE FROM public.expense_claims;
DELETE FROM public.employees;

DELETE FROM public.inventory_reservations;
DELETE FROM public.inventory_serials;
DELETE FROM public.inventory_lots;
DELETE FROM public.inventory_cost_layers;
DELETE FROM public.inventory_audit_logs;
DELETE FROM public.warehouse_stock;
DELETE FROM public.stock_count_sessions;
DELETE FROM public.stock_movements;
DELETE FROM public.inventory_items;

DELETE FROM public.budgets;
DELETE FROM public.fixed_assets;
DELETE FROM public.custom_field_values;
DELETE FROM public.document_tag_assignments;
DELETE FROM public.document_relationships;
DELETE FROM public.document_ocr_metadata;
DELETE FROM public.document_comments;
DELETE FROM public.document_versions;
DELETE FROM public.documents;

DELETE FROM public.workflow_notifications;
DELETE FROM public.workflow_history;
DELETE FROM public.workflow_tasks;
DELETE FROM public.workflow_delegations;
DELETE FROM public.workflow_instances;

DELETE FROM public.automation_runs;
DELETE FROM public.webhook_deliveries;
DELETE FROM public.api_usage_logs;
DELETE FROM public.platform_notifications;
DELETE FROM public.notification_delivery_log;
DELETE FROM public.search_recent;
DELETE FROM public.report_daily_summaries;
DELETE FROM public.report_schedules;

DELETE FROM public.audit_logs;
DO $$ BEGIN
  IF to_regclass('public.audit_logs_archive') IS NOT NULL THEN
    DELETE FROM public.audit_logs_archive;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Master / dimensional operational data
-- ---------------------------------------------------------------------------
DELETE FROM public.customers;
DELETE FROM public.vendors;
DELETE FROM public.exchange_rates;
DELETE FROM public.cost_centers;

-- Clear COA self-parent links then delete all accounts
UPDATE public.chart_of_accounts SET parent_id = NULL WHERE parent_id IS NOT NULL;
DELETE FROM public.chart_of_accounts;

-- ---------------------------------------------------------------------------
-- 5. Reset numbering / posting counters (preserve configuration rows)
-- ---------------------------------------------------------------------------
UPDATE public.document_sequences
SET next_number = starting_number,
    updated_at = now()
WHERE next_number <> starting_number;

UPDATE public.sequences
SET next_no = 1
WHERE next_no <> 1;

UPDATE public.posting_sequences
SET last_sequence = 0,
    updated_at = now()
WHERE last_sequence <> 0;

UPDATE public.numbering_series
SET next_number = 1
WHERE next_number <> 1;

-- ---------------------------------------------------------------------------
-- 6. Verification — raise on any leftover operational data or preserve drift
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fail text[] := ARRAY[]::text[];
  v_before bigint;
  v_after bigint;
  v_entity text;
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
    'job_queue','job_history','dead_letter_queue',
    'migration_wizard_sessions','migration_id_map',
    'quickbooks_migration_records','quickbooks_migration_local_links',
    'quickbooks_migration_checkpoints','quickbooks_migration_warnings',
    'quickbooks_materialization_runs','quickbooks_extraction_staging',
    'quickbooks_certification_runs','quickbooks_certification_sections',
    'quickbooks_cutoff_reconciliations','quickbooks_opening_balance_details',
    'quickbooks_retained_earnings_periods','quickbooks_webhook_events',
    'accounting_sync_runs','accounting_sync_changes','accounting_integration_logs',
    'tax_agencies','tax_filing_periods','tax_settlements'
  ];
  v_table text;
BEGIN
  FOREACH v_entity IN ARRAY ARRAY[
    'companies','profiles','company_users','company_settings','company_subscriptions',
    'company_zatca_settings','zatca_credentials','accounting_integration_providers',
    'accounting_integration_connections','accounting_integration_oauth_states',
    'company_currencies','currency_settings','tax_rates','tax_groups','tax_group_rates',
    'document_sequences','sequences','feature_flags','payment_terms','payment_methods',
    'warehouses','units_of_measure'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_entity) INTO v_after;
    SELECT n INTO v_before FROM _reset_preserve_before WHERE entity = v_entity;
    IF v_before IS DISTINCT FROM v_after THEN
      v_fail := array_append(v_fail, format('preserve drift %s: before=%s after=%s', v_entity, v_before, v_after));
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = '05585a44-672d-4bab-aa40-6dfe022c19a0'
  ) THEN
    v_fail := array_append(v_fail, 'benchmark company missing after reset');
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
    IF v_count > 0 THEN
      v_fail := array_append(v_fail, format('%s still has %s rows', v_table, v_count));
    END IF;
  END LOOP;

  -- Document / posting counters must be reset
  IF EXISTS (
    SELECT 1 FROM public.document_sequences WHERE next_number <> starting_number
  ) THEN
    v_fail := array_append(v_fail, 'document_sequences.next_number not reset to starting_number');
  END IF;

  IF EXISTS (SELECT 1 FROM public.sequences WHERE next_no <> 1) THEN
    v_fail := array_append(v_fail, 'sequences.next_no not reset to 1');
  END IF;

  IF EXISTS (SELECT 1 FROM public.posting_sequences WHERE last_sequence <> 0) THEN
    v_fail := array_append(v_fail, 'posting_sequences.last_sequence not reset to 0');
  END IF;

  -- currency_settings must not still reference deleted COA
  IF EXISTS (
    SELECT 1 FROM public.currency_settings
    WHERE realized_gain_account_id IS NOT NULL
       OR realized_loss_account_id IS NOT NULL
       OR unrealized_gain_account_id IS NOT NULL
       OR unrealized_loss_account_id IS NOT NULL
  ) THEN
    v_fail := array_append(v_fail, 'currency_settings still references chart_of_accounts');
  END IF;

  IF array_length(v_fail, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Operational reset verification failed: %', array_to_string(v_fail, '; ');
  END IF;

  RAISE NOTICE 'Operational reset OK. companies=% companies preserved; OAuth connections=%; target company present; all audited operational tables empty.',
    (SELECT n FROM _reset_preserve_before WHERE entity = 'companies'),
    (SELECT n FROM _reset_preserve_before WHERE entity = 'accounting_integration_connections');
END $$;

COMMIT;

-- =============================================================================
-- Post-commit read-only checks (safe to re-run; outside the transaction)
-- =============================================================================
-- SELECT id, slug, company_name FROM public.companies ORDER BY created_at;
-- SELECT tenant_id, status, realm_id FROM public.accounting_integration_connections;
-- SELECT count(*) AS import_jobs FROM public.import_jobs;
-- SELECT count(*) AS job_queue FROM public.job_queue;
-- SELECT count(*) AS migration_sessions FROM public.migration_wizard_sessions;
-- SELECT count(*) AS checkpoints FROM public.quickbooks_migration_checkpoints;
-- SELECT count(*) AS customers FROM public.customers;
-- SELECT count(*) AS coa FROM public.chart_of_accounts;
-- SELECT count(*) AS qb_records FROM public.quickbooks_migration_records;
-- SELECT id FROM public.companies WHERE id = '05585a44-672d-4bab-aa40-6dfe022c19a0';
-- SELECT count(*) FROM public.accounting_integration_connections
--   WHERE tenant_id = '05585a44-672d-4bab-aa40-6dfe022c19a0';
--   -- Expected: 0 until you reconnect QuickBooks for the benchmark tenant.
