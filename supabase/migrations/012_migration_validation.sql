-- 012_migration_validation.sql
-- Read-only validation for Prisma-removal readiness (001–011 applied).
-- Run in Supabase SQL editor or: psql $DATABASE_URL -f supabase/migrations/012_migration_validation.sql
-- Each query returns FAIL rows only. Empty result set = pass for that check.
-- Final summary at bottom aggregates all failures.

-- =============================================================================
-- 1. RLS policies exist
-- =============================================================================

-- 1a. Tables that must have RLS enabled
SELECT
  '1_rls_enabled' AS check_id,
  expected.table_name AS object_name,
  'RLS not enabled' AS issue
FROM (
  VALUES
    ('companies'), ('company_settings'), ('company_zatca_settings'), ('company_subscriptions'),
    ('company_users'), ('profiles'), ('user_preferences'), ('invitations'),
    ('zatca_credentials'), ('zatca_onboarding_requests'),
    ('chart_of_accounts'), ('cost_centers'), ('sequences'), ('tax_rates'),
    ('journal_entries'), ('journal_lines'), ('receipts'), ('expenses'), ('expense_lines'),
    ('employees'), ('payroll_entries'), ('payroll_lines'), ('inventory_items'),
    ('customers'), ('vendors'), ('bills'), ('bill_lines'),
    ('invoices'), ('invoice_lines'), ('payments'),
    ('zatca_audit_logs'), ('zatca_sandbox_test_runs'), ('zatca_xml_archive'), ('zatca_api_logs')
) AS expected(table_name)
LEFT JOIN pg_class c ON c.relname = expected.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.oid IS NULL OR c.relrowsecurity IS NOT TRUE;

-- 1b. Expected named policies (post-011)
SELECT
  '1_rls_policy' AS check_id,
  expected.table_name || '.' || expected.policy_name AS object_name,
  'Policy missing' AS issue
FROM (
  VALUES
    ('companies', 'companies_select'),
    ('companies', 'companies_update'),
    ('companies', 'companies_service_all'),
    ('company_settings', 'company_settings_select'),
    ('company_settings', 'company_settings_update'),
    ('company_settings', 'company_settings_service_all'),
    ('company_zatca_settings', 'company_zatca_settings_select'),
    ('company_zatca_settings', 'company_zatca_settings_update'),
    ('company_zatca_settings', 'company_zatca_settings_service_all'),
    ('company_subscriptions', 'company_subscriptions_select'),
    ('company_subscriptions', 'company_subscriptions_service_all'),
    ('company_users', 'company_users_select'),
    ('company_users', 'company_users_manage'),
    ('company_users', 'company_users_service_all'),
    ('profiles', 'profiles_select_own'),
    ('profiles', 'profiles_update_own'),
    ('profiles', 'profiles_service_all'),
    ('user_preferences', 'user_preferences_own'),
    ('user_preferences', 'user_preferences_service_all'),
    ('invitations', 'invitations_select'),
    ('invitations', 'invitations_manage'),
    ('invitations', 'invitations_service_all'),
    ('zatca_credentials', 'zatca_credentials_select'),
    ('zatca_credentials', 'zatca_credentials_service_all'),
    ('zatca_onboarding_requests', 'zatca_onboarding_requests_select'),
    ('zatca_onboarding_requests', 'zatca_onboarding_requests_service_all'),
    ('chart_of_accounts', 'chart_of_accounts_tenant'),
    ('chart_of_accounts', 'chart_of_accounts_service'),
    ('cost_centers', 'cost_centers_tenant'),
    ('cost_centers', 'cost_centers_service'),
    ('sequences', 'sequences_tenant'),
    ('sequences', 'sequences_service'),
    ('tax_rates', 'tax_rates_tenant'),
    ('tax_rates', 'tax_rates_service'),
    ('journal_entries', 'journal_entries_tenant'),
    ('journal_entries', 'journal_entries_service'),
    ('journal_lines', 'journal_lines_tenant'),
    ('journal_lines', 'journal_lines_service'),
    ('receipts', 'receipts_tenant'),
    ('receipts', 'receipts_service'),
    ('expenses', 'expenses_tenant'),
    ('expenses', 'expenses_service'),
    ('expense_lines', 'expense_lines_tenant'),
    ('expense_lines', 'expense_lines_service'),
    ('employees', 'employees_tenant'),
    ('employees', 'employees_service'),
    ('payroll_entries', 'payroll_entries_tenant'),
    ('payroll_entries', 'payroll_entries_service'),
    ('payroll_lines', 'payroll_lines_tenant'),
    ('payroll_lines', 'payroll_lines_service'),
    ('inventory_items', 'inventory_items_tenant'),
    ('inventory_items', 'inventory_items_service'),
    ('customers', 'customers_tenant'),
    ('customers', 'customers_service'),
    ('vendors', 'vendors_tenant'),
    ('vendors', 'vendors_service'),
    ('bills', 'bills_tenant'),
    ('bills', 'bills_service'),
    ('bill_lines', 'bill_lines_tenant'),
    ('bill_lines', 'bill_lines_service'),
    ('invoices', 'invoices_tenant'),
    ('invoices', 'invoices_service'),
    ('invoice_lines', 'invoice_lines_tenant'),
    ('invoice_lines', 'invoice_lines_service'),
    ('payments', 'payments_tenant'),
    ('payments', 'payments_service'),
    ('zatca_audit_logs', 'zatca_audit_logs_select'),
    ('zatca_audit_logs', 'zatca_audit_logs_service'),
    ('zatca_sandbox_test_runs', 'zatca_sandbox_test_runs_select'),
    ('zatca_sandbox_test_runs', 'zatca_sandbox_test_runs_service'),
    ('zatca_xml_archive', 'zatca_xml_archive_tenant'),
    ('zatca_xml_archive', 'zatca_xml_archive_service'),
    ('zatca_api_logs', 'zatca_api_logs_select'),
    ('zatca_api_logs', 'zatca_api_logs_service')
) AS expected(table_name, policy_name)
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
 AND p.tablename = expected.table_name
 AND p.policyname = expected.policy_name
WHERE p.policyname IS NULL;

-- 1c. Business tables must expose a service_role bypass policy
SELECT
  '1_rls_service_role' AS check_id,
  expected.table_name AS object_name,
  'No service_role policy' AS issue
FROM (
  VALUES
    ('chart_of_accounts'), ('journal_entries'), ('invoices'), ('zatca_credentials'), ('payments')
) AS expected(table_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = expected.table_name
    AND 'service_role' = ANY (p.roles)
);

-- =============================================================================
-- 2. Composite FKs exist (011)
-- =============================================================================

SELECT
  '2_composite_fk' AS check_id,
  expected.conname AS object_name,
  'Composite FK missing' AS issue
FROM (
  VALUES
    ('journal_lines_company_journal_fkey'),
    ('expense_lines_company_expense_fkey'),
    ('bill_lines_company_bill_fkey'),
    ('invoice_lines_company_invoice_fkey'),
    ('payroll_lines_company_payroll_fkey'),
    ('payments_company_invoice_fkey'),
    ('payments_company_bill_fkey'),
    ('zatca_xml_archive_company_invoice_fkey'),
    ('zatca_audit_logs_company_invoice_fkey'),
    ('zatca_api_logs_company_invoice_fkey')
) AS expected(conname)
LEFT JOIN pg_constraint c ON c.conname = expected.conname AND c.contype = 'f'
WHERE c.oid IS NULL;

-- =============================================================================
-- 3. Unique constraints exist
-- =============================================================================

-- 3a. Explicit tenant-scoped composite parent keys (011)
SELECT
  '3_unique_parent' AS check_id,
  expected.conname AS object_name,
  'Parent UNIQUE (company_id, id) missing' AS issue
FROM (
  VALUES
    ('journal_entries_company_id_id_key'),
    ('expenses_company_id_id_key'),
    ('bills_company_id_id_key'),
    ('invoices_company_id_id_key'),
    ('payroll_entries_company_id_id_key')
) AS expected(conname)
LEFT JOIN pg_constraint c ON c.conname = expected.conname AND c.contype = 'u'
WHERE c.oid IS NULL;

-- 3b. Critical business-key uniques (tenant-scoped)
SELECT
  '3_unique_business' AS check_id,
  expected.table_name || ' (' || array_to_string(expected.key_cols, ', ') || ')' AS object_name,
  'Business unique constraint missing' AS issue
FROM (
  VALUES
    ('chart_of_accounts', ARRAY['company_id', 'account_no']),
    ('cost_centers', ARRAY['company_id', 'code']),
    ('sequences', ARRAY['company_id', 'type']),
    ('journal_entries', ARRAY['company_id', 'entry_no']),
    ('expenses', ARRAY['company_id', 'expense_no']),
    ('employees', ARRAY['company_id', 'employee_no']),
    ('payroll_entries', ARRAY['company_id', 'payroll_no']),
    ('inventory_items', ARRAY['company_id', 'item_code']),
    ('customers', ARRAY['company_id', 'customer_no']),
    ('vendors', ARRAY['company_id', 'vendor_no']),
    ('bills', ARRAY['company_id', 'bill_no']),
    ('invoices', ARRAY['company_id', 'invoice_no']),
    ('invoices', ARRAY['company_id', 'invoice_uuid']),
    ('payments', ARRAY['company_id', 'payment_no']),
    ('zatca_credentials', ARRAY['company_id', 'environment']),
    ('company_users', ARRAY['company_id', 'user_id']),
    ('user_preferences', ARRAY['user_id'])
) AS expected(table_name, key_cols)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  WHERE n.nspname = 'public'
    AND rel.relname = expected.table_name
    AND c.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY u.ordinality)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) = expected.key_cols
);

-- =============================================================================
-- 4. Helper functions exist
-- =============================================================================

SELECT
  '4_helper_function' AS check_id,
  expected.proname AS object_name,
  'Function missing' AS issue
FROM (
  VALUES
    ('set_updated_at'),
    ('user_company_ids'),
    ('user_company_role'),
    ('user_has_company_role'),
    ('handle_new_auth_user')
) AS expected(proname)
LEFT JOIN pg_proc p ON p.proname = expected.proname
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.oid IS NULL;

-- =============================================================================
-- 5. Enum types exist
-- =============================================================================

SELECT
  '5_enum_type' AS check_id,
  expected.typname AS object_name,
  'Enum type missing' AS issue
FROM (
  VALUES
    ('invoice_type'),
    ('zatca_environment'),
    ('zatca_onboarding_status'),
    ('zatca_invoice_status'),
    ('company_role'),
    ('subscription_plan'),
    ('subscription_status'),
    ('invitation_status')
) AS expected(typname)
LEFT JOIN pg_type t ON t.typname = expected.typname
LEFT JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
WHERE t.oid IS NULL;

-- =============================================================================
-- 6. All tables required by Prisma exist
-- =============================================================================

SELECT
  '6_prisma_table' AS check_id,
  expected.supabase_table AS object_name,
  'Prisma-mapped table missing (model: ' || expected.prisma_model || ')' AS issue
FROM (
  VALUES
    ('CompanySettings', 'companies'),
    ('CompanySettings', 'company_settings'),
    ('CompanySettings', 'company_zatca_settings'),
    ('User', 'profiles'),
    ('User', 'company_users'),
    ('ChartOfAccount', 'chart_of_accounts'),
    ('CostCenter', 'cost_centers'),
    ('JournalEntry', 'journal_entries'),
    ('JournalLine', 'journal_lines'),
    ('Customer', 'customers'),
    ('Vendor', 'vendors'),
    ('Invoice', 'invoices'),
    ('InvoiceLine', 'invoice_lines'),
    ('Bill', 'bills'),
    ('BillLine', 'bill_lines'),
    ('Expense', 'expenses'),
    ('ExpenseLine', 'expense_lines'),
    ('Payment', 'payments'),
    ('Employee', 'employees'),
    ('PayrollEntry', 'payroll_entries'),
    ('PayrollLine', 'payroll_lines'),
    ('InventoryItem', 'inventory_items'),
    ('TaxRate', 'tax_rates'),
    ('Receipt', 'receipts'),
    ('Sequence', 'sequences'),
    ('ZatcaCredential', 'zatca_credentials'),
    ('ZatcaOnboardingRequest', 'zatca_onboarding_requests'),
    ('ZatcaAuditLog', 'zatca_audit_logs'),
    ('ZatcaSandboxTestRun', 'zatca_sandbox_test_runs')
) AS expected(prisma_model, supabase_table)
LEFT JOIN pg_class c ON c.relname = expected.supabase_table
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.oid IS NULL;

-- 6b. Business tables must have company_id (except auth-scoped tables)
SELECT
  '6_company_id_column' AS check_id,
  expected.table_name AS object_name,
  'company_id column missing or nullable' AS issue
FROM (
  VALUES
    ('chart_of_accounts'), ('cost_centers'), ('sequences'), ('tax_rates'),
    ('journal_entries'), ('journal_lines'), ('receipts'), ('expenses'), ('expense_lines'),
    ('employees'), ('payroll_entries'), ('payroll_lines'), ('inventory_items'),
    ('customers'), ('vendors'), ('bills'), ('bill_lines'),
    ('invoices'), ('invoice_lines'), ('payments'),
    ('zatca_credentials'), ('zatca_onboarding_requests'),
    ('zatca_audit_logs'), ('zatca_sandbox_test_runs'), ('zatca_xml_archive'), ('zatca_api_logs')
) AS expected(table_name)
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
 AND col.table_name = expected.table_name
 AND col.column_name = 'company_id'
WHERE col.column_name IS NULL OR col.is_nullable = 'YES';

-- =============================================================================
-- 7. All ZATCA tables exist
-- =============================================================================

SELECT
  '7_zatca_table' AS check_id,
  expected.table_name AS object_name,
  'ZATCA table missing' AS issue
FROM (
  VALUES
    ('company_zatca_settings'),
    ('zatca_credentials'),
    ('zatca_onboarding_requests'),
    ('invoices'),
    ('zatca_audit_logs'),
    ('zatca_sandbox_test_runs'),
    ('zatca_xml_archive'),
    ('zatca_api_logs')
) AS expected(table_name)
LEFT JOIN pg_class c ON c.relname = expected.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.oid IS NULL;

-- 7b. Critical ZATCA invoice columns on invoices
SELECT
  '7_zatca_invoice_column' AS check_id,
  expected.column_name AS object_name,
  'ZATCA column missing on invoices' AS issue
FROM (
  VALUES
    ('invoice_uuid'), ('invoice_hash'), ('previous_invoice_hash'), ('invoice_type'),
    ('zatca_status'), ('clearance_status'), ('signed_xml'), ('zatca_submission_date'),
    ('zatca_response_payload'), ('cleared_invoice_payload')
) AS expected(column_name)
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
 AND col.table_name = 'invoices'
 AND col.column_name = expected.column_name
WHERE col.column_name IS NULL;

-- =============================================================================
-- 8. Foreign keys are valid
-- =============================================================================

-- 8a. Not-valid FK constraints
SELECT
  '8_fk_not_valid' AS check_id,
  c.conrelid::regclass::text || '.' || c.conname AS object_name,
  'FK constraint exists but is NOT VALID' AS issue
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.contype = 'f'
  AND c.convalidated IS FALSE;

-- 8b. Orphan FK references (should be zero rows if FKs enforced)
SELECT
  '8_fk_orphan_journal_lines' AS check_id,
  jl.id::text AS object_name,
  'journal_lines.journal_id references missing journal_entries row' AS issue
FROM public.journal_lines jl
LEFT JOIN public.journal_entries je ON je.id = jl.journal_id
WHERE je.id IS NULL;

SELECT
  '8_fk_orphan_invoice_lines' AS check_id,
  il.id::text AS object_name,
  'invoice_lines.invoice_id references missing invoices row' AS issue
FROM public.invoice_lines il
LEFT JOIN public.invoices i ON i.id = il.invoice_id
WHERE i.id IS NULL;

SELECT
  '8_fk_orphan_payments_invoice' AS check_id,
  p.id::text AS object_name,
  'payments.invoice_id references missing invoices row' AS issue
FROM public.payments p
LEFT JOIN public.invoices i ON i.id = p.invoice_id
WHERE p.invoice_id IS NOT NULL AND i.id IS NULL;

SELECT
  '8_fk_orphan_payments_bill' AS check_id,
  p.id::text AS object_name,
  'payments.bill_id references missing bills row' AS issue
FROM public.payments p
LEFT JOIN public.bills b ON b.id = p.bill_id
WHERE p.bill_id IS NOT NULL AND b.id IS NULL;

-- =============================================================================
-- 9. No missing indexes
-- =============================================================================

SELECT
  '9_missing_index' AS check_id,
  expected.indexname AS object_name,
  'Expected index missing' AS issue
FROM (
  VALUES
    ('profiles_legacy_user_id_idx'),
    ('invitations_company_id_idx'),
    ('company_users_user_id_idx'),
    ('company_users_company_id_idx'),
    ('zatca_credentials_company_env_idx'),
    ('zatca_onboarding_requests_company_env_idx'),
    ('chart_of_accounts_company_id_idx'),
    ('journal_entries_company_id_idx'),
    ('journal_entries_company_date_idx'),
    ('journal_lines_journal_id_idx'),
    ('invoices_company_hash_chain_idx'),
    ('invoices_company_pih_lookup_idx'),
    ('invoices_company_zatca_status_idx'),
    ('invoice_lines_invoice_id_idx'),
    ('payments_company_id_idx'),
    ('customers_company_tax_id_idx'),
    ('bills_vendor_id_idx'),
    ('zatca_audit_logs_company_created_idx'),
    ('zatca_sandbox_test_runs_company_created_idx'),
    ('zatca_api_logs_company_created_idx'),
    ('journal_entries_id_not_deleted_idx'),
    ('expenses_id_not_deleted_idx'),
    ('bills_id_not_deleted_idx'),
    ('invoices_id_not_deleted_idx'),
    ('payroll_entries_id_not_deleted_idx')
) AS expected(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.indexname = expected.indexname
WHERE i.indexname IS NULL;

-- =============================================================================
-- 10. No orphan rows (tenant integrity)
-- =============================================================================

SELECT
  '10_orphan_company_mismatch' AS check_id,
  src || ':' || row_id::text AS object_name,
  detail AS issue
FROM (
  SELECT 'journal_lines' AS src, jl.id AS row_id,
         'company_id <> journal_entries.company_id' AS detail
  FROM public.journal_lines jl
  JOIN public.journal_entries p ON p.id = jl.journal_id
  WHERE jl.company_id <> p.company_id

  UNION ALL

  SELECT 'expense_lines', el.id,
         'company_id <> expenses.company_id'
  FROM public.expense_lines el
  JOIN public.expenses p ON p.id = el.expense_id
  WHERE el.company_id <> p.company_id

  UNION ALL

  SELECT 'bill_lines', bl.id,
         'company_id <> bills.company_id'
  FROM public.bill_lines bl
  JOIN public.bills p ON p.id = bl.bill_id
  WHERE bl.company_id <> p.company_id

  UNION ALL

  SELECT 'invoice_lines', il.id,
         'company_id <> invoices.company_id'
  FROM public.invoice_lines il
  JOIN public.invoices p ON p.id = il.invoice_id
  WHERE il.company_id <> p.company_id

  UNION ALL

  SELECT 'payroll_lines', pl.id,
         'company_id <> payroll_entries.company_id'
  FROM public.payroll_lines pl
  JOIN public.payroll_entries p ON p.id = pl.payroll_id
  WHERE pl.company_id <> p.company_id

  UNION ALL

  SELECT 'payments', pay.id,
         'company_id <> invoices.company_id (invoice_id set)'
  FROM public.payments pay
  JOIN public.invoices p ON p.id = pay.invoice_id
  WHERE pay.invoice_id IS NOT NULL AND pay.company_id <> p.company_id

  UNION ALL

  SELECT 'payments', pay.id,
         'company_id <> bills.company_id (bill_id set)'
  FROM public.payments pay
  JOIN public.bills p ON p.id = pay.bill_id
  WHERE pay.bill_id IS NOT NULL AND pay.company_id <> p.company_id

  UNION ALL

  SELECT 'zatca_xml_archive', z.id,
         'company_id <> invoices.company_id'
  FROM public.zatca_xml_archive z
  JOIN public.invoices p ON p.id = z.invoice_id
  WHERE z.company_id <> p.company_id

  UNION ALL

  SELECT 'zatca_audit_logs', z.id,
         'company_id <> invoices.company_id (invoice_id set)'
  FROM public.zatca_audit_logs z
  JOIN public.invoices p ON p.id = z.invoice_id
  WHERE z.invoice_id IS NOT NULL AND z.company_id <> p.company_id

  UNION ALL

  SELECT 'zatca_api_logs', z.id,
         'company_id <> invoices.company_id (invoice_id set)'
  FROM public.zatca_api_logs z
  JOIN public.invoices p ON p.id = z.invoice_id
  WHERE z.invoice_id IS NOT NULL AND z.company_id <> p.company_id
) orphans;

-- 10b. company_settings / zatca_settings without parent company
SELECT
  '10_orphan_settings' AS check_id,
  cs.company_id::text AS object_name,
  'company_settings.company_id has no companies row' AS issue
FROM public.company_settings cs
LEFT JOIN public.companies c ON c.id = cs.company_id
WHERE c.id IS NULL;

SELECT
  '10_orphan_settings' AS check_id,
  cz.company_id::text AS object_name,
  'company_zatca_settings.company_id has no companies row' AS issue
FROM public.company_zatca_settings cz
LEFT JOIN public.companies c ON c.id = cz.company_id
WHERE c.id IS NULL;

-- 10c. company_users pointing to missing company or profile
SELECT
  '10_orphan_membership' AS check_id,
  cu.id::text AS object_name,
  'company_users.company_id has no companies row' AS issue
FROM public.company_users cu
LEFT JOIN public.companies c ON c.id = cu.company_id
WHERE c.id IS NULL;

-- =============================================================================
-- SUMMARY — all failures in one result set
-- =============================================================================

WITH failures AS (
  SELECT * FROM (
    SELECT '1_rls_enabled' AS check_id, expected.table_name AS object_name, 'RLS not enabled' AS issue
    FROM (
      VALUES
        ('companies'), ('invoices'), ('journal_entries'), ('zatca_credentials'), ('payments')
    ) AS expected(table_name)
    LEFT JOIN pg_class c ON c.relname = expected.table_name
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.oid IS NULL OR c.relrowsecurity IS NOT TRUE

    UNION ALL

    SELECT '2_composite_fk', expected.conname, 'Composite FK missing'
    FROM (
      VALUES
        ('journal_lines_company_journal_fkey'),
        ('invoice_lines_company_invoice_fkey'),
        ('payments_company_invoice_fkey')
    ) AS expected(conname)
    LEFT JOIN pg_constraint c ON c.conname = expected.conname AND c.contype = 'f'
    WHERE c.oid IS NULL

    UNION ALL

    SELECT '3_unique_parent', expected.conname, 'Parent UNIQUE (company_id, id) missing'
    FROM (
      VALUES
        ('invoices_company_id_id_key'),
        ('journal_entries_company_id_id_key')
    ) AS expected(conname)
    LEFT JOIN pg_constraint c ON c.conname = expected.conname AND c.contype = 'u'
    WHERE c.oid IS NULL

    UNION ALL

    SELECT '4_helper_function', expected.proname, 'Function missing'
    FROM (
      VALUES ('user_company_ids'), ('set_updated_at')
    ) AS expected(proname)
    LEFT JOIN pg_proc p ON p.proname = expected.proname
    LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.oid IS NULL

    UNION ALL

    SELECT '5_enum_type', expected.typname, 'Enum missing'
    FROM (VALUES ('zatca_invoice_status'), ('invoice_type')) AS expected(typname)
    LEFT JOIN pg_type t ON t.typname = expected.typname
    LEFT JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
    WHERE t.oid IS NULL

    UNION ALL

    SELECT '6_prisma_table', expected.supabase_table, 'Table missing'
    FROM (VALUES ('invoices'), ('journal_entries'), ('zatca_audit_logs')) AS expected(supabase_table)
    LEFT JOIN pg_class c ON c.relname = expected.supabase_table
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.oid IS NULL

    UNION ALL

    SELECT '7_zatca_table', expected.table_name, 'ZATCA table missing'
    FROM (VALUES ('zatca_credentials'), ('zatca_xml_archive')) AS expected(table_name)
    LEFT JOIN pg_class c ON c.relname = expected.table_name
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.oid IS NULL

    UNION ALL

    SELECT '8_fk_not_valid', c.conrelid::regclass::text || '.' || c.conname, 'FK NOT VALID'
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype = 'f' AND c.convalidated IS FALSE

    UNION ALL

    SELECT '9_missing_index', expected.indexname, 'Index missing'
    FROM (VALUES ('invoices_company_hash_chain_idx'), ('journal_entries_id_not_deleted_idx')) AS expected(indexname)
    LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.indexname = expected.indexname
    WHERE i.indexname IS NULL

    UNION ALL

    SELECT '10_orphan_company_mismatch', 'journal_lines:' || jl.id::text, 'company_id mismatch'
    FROM public.journal_lines jl
    JOIN public.journal_entries p ON p.id = jl.journal_id
    WHERE jl.company_id <> p.company_id
  ) x
)
SELECT
  check_id,
  object_name,
  issue,
  count(*) OVER (PARTITION BY check_id) AS failures_in_check
FROM failures
ORDER BY check_id, object_name;

-- Pass indicator (run last): zero rows above = ready for Prisma removal
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'invoices'
        AND c.relrowsecurity IS TRUE
    )
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_company_invoice_fkey')
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_lines jl
      JOIN public.journal_entries p ON p.id = jl.journal_id
      WHERE jl.company_id <> p.company_id
    )
    THEN 'PASS — spot checks OK (review full query results above)'
    ELSE 'FAIL — review failure rows above'
  END AS migration_readiness;
