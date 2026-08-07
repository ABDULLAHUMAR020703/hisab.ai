# Operational data reset — dependency audit

Live audit timestamp: **2026-08-06T07:25:27Z**  
Script: [`scripts/db/reset-operational-data.sql`](../../scripts/db/reset-operational-data.sql)  
Raw counts: [`test-data/benchmarks/db-reset-audit.json`](../benchmarks/db-reset-audit.json)

**This document is the plan. The SQL has not been executed.**

## Companies in the database (all preserved)

| id | slug | name | currency |
|---|---|---|---|
| `00000000-0000-4000-8000-000000000001` | netkom | NETKOM COMPANY FOR COMMUNICATION | USD |
| `05585a44-672d-4bab-aa40-6dfe022c19a0` | netkom-production-355afeb53136 | NETKOM COMPANY FOR COMMUNICATION | SAR |
| `f5b2a58b-0bd6-4a46-819d-d45a01ec06ca` | techdotglobal | TechDot Global | PKR |

Benchmark tenant: **`05585a44-672d-4bab-aa40-6dfe022c19a0`** (OWNER `d82157b8-e4de-4dc9-9273-a6180d2b3af1`).

## Critical OAuth finding

| tenant | OAuth status | realm |
|---|---|---|
| `00000000-…0001` | CONNECTED | `9341457612363747` |
| `f5b2a58b-…` | CONNECTED | `9341457612363747` |
| `05585a44-…` | **none** | — |

The script **preserves every existing** `accounting_integration_connections` / oauth-state row. It cannot create a QuickBooks connection for `05585a44…`. After cleanup you must reconnect QuickBooks to that tenant before a migration benchmark.

## Tables preserved (do not delete)

| Category | Tables |
|---|---|
| Tenants | `companies`, `company_settings`, `company_zatca_settings`, `company_subscriptions` |
| Auth / membership | `profiles`, `company_users`, `user_preferences`, `invitations`, `auth.users` (auth schema, untouched) |
| ZATCA credentials | `zatca_credentials`, `zatca_onboarding_requests` |
| QuickBooks OAuth | `accounting_integration_providers`, `accounting_integration_connections`, `accounting_integration_oauth_states` |
| Currencies | `company_currencies`, `currency_settings` (account FKs nulled) |
| Tax config | `tax_rates`, `tax_groups`, `tax_group_rates`, `tax_exemptions`, `regional_tax_rules` |
| Numbering | `document_sequences`, `sequences`, `posting_sequences`, `numbering_series` (**counters reset**) |
| Flags / locale | `feature_flags`, `feature_flag_overrides`, `locale_settings`, `translations` |
| Master config catalogs | `payment_terms`, `payment_methods`, `units_of_measure`, `warehouses`, `departments`, `expense_categories`, `customer_types`, `custom_field_definitions` |
| Sync settings only | `accounting_sync_settings` |
| Platform config (empty today) | workflow templates/bindings, automation rules, webhooks endpoints, API keys, connectors, report definitions/templates/permissions, retention policies, notification preferences |

### Preserve exception

`tax_agencies` (2 rows, Arizona / Board of Equalization on the sandbox tenant) have **`liability_account_id NOT NULL` + `ON DELETE RESTRICT`** to `chart_of_accounts`. Keeping them would force keeping COA rows. They are **deleted** so COA can be fully emptied; `tax_rates` / `tax_groups` remain.

## Global / shared tables

| Table | Scope | Action |
|---|---|---|
| `accounting_integration_providers` | Global provider catalog | Preserve |
| `feature_flags` | Global defaults | Preserve |
| `integration_connectors` | Global connector catalog | Preserve |
| `translations` | Global | Preserve |
| `auth.users` / `auth.*` | Supabase Auth | Untouched |

Everything else with `company_id` is tenant-scoped. Deletes are **global across all companies** (not filtered to one tenant), matching “every company becomes empty.”

## Row counts that will be deleted (live, non-zero only)

| Table | Rows |
|---|---|
| `quickbooks_migration_local_links` | 40,540 |
| `quickbooks_migration_records` | 40,496 |
| `quickbooks_materialization_runs` | 40,164 |
| `exchange_rates` | 40,046 |
| `chart_of_accounts` | 548 |
| `job_history` | 472 |
| `job_queue` | 471 |
| `zatca_audit_logs` | 319 |
| `cost_centers` | 317 |
| `invoice_lines` | 315 |
| `import_jobs` | 267 |
| `ledger_entries` | 264 |
| `invoices` | 223 |
| `import_job_errors` | 217 |
| `accounting_sync_changes` | 166 |
| `zatca_api_logs` | 156 |
| `audit_logs` | 121 |
| `accounting_integration_logs` | 102 |
| `customers` | 77 |
| `quickbooks_certification_sections` | 75 |
| `vendors` | 67 |
| `zatca_sandbox_test_runs` | 44 |
| `inventory_items` | 42 |
| `quickbooks_migration_checkpoints` | 39 |
| `expense_lines` / `expenses` | 38 / 35 |
| `quickbooks_migration_warnings` | 29 |
| `payments` / `payment_allocations` | 26 / 26 |
| `stock_movements` / `inventory_audit_logs` | 24 / 24 |
| `fixed_assets` | 18 |
| `bills` / `bill_lines` | 15 / 16 |
| `estimate_lines` / `estimates` | 15 / 4 |
| `deposit_allocations` / `deposit_audit_log` | 12 / 9 |
| `import_job_skips` | 9 |
| `purchase_order_lines` / `purchase_orders` | 7 / 3 |
| `bank_transactions` | 5 |
| `migration_wizard_sessions` | 5 |
| `sales_receipt_lines` / `sales_receipts` | 5 / 4 |
| `time_activities` | 5 |
| `import_mapping_templates` | 4 |
| `journal_lines` / `journal_entries` | 4 / 3 |
| `fiscal_periods` | 3 |
| `quickbooks_certification_runs` | 3 |
| `bank_accounts` | 2 |
| `employees` | 2 |
| `tax_agencies` | 2 |
| `accounting_sync_runs` | 1 |
| `recurring_transaction_templates` | 1 |

Plus every currently-empty operational table listed in the SQL (still deleted for idempotency).

### Benchmark tenant (`05585a44…`) non-zero subset

`cost_centers` 143, `zatca_audit_logs` 77, `invoice_lines` 55, `zatca_api_logs` 33, `invoices` 25, `chart_of_accounts` 4, `customers` 3, `exchange_rates` 1, `audit_logs` 1, `migration_wizard_sessions` 1, `fiscal_periods` 1.

## FK dependency order (high level)

```
1. Null preserved-config FKs → COA
   currency_settings.*, tax_rates.gl_account_id, payment_methods.clearing_account_id,
   expense_categories.account_id, inventory_items.*_account_id

2. Delete RESTRICT tax agency chain
   tax_settlements → tax_filing_periods → tax_agencies

3. Migration / queue artifacts
   import_job_skips/errors → import_jobs → templates
   job_history / DLQ → job_queue
   QB staging/warnings/links/records/checkpoints/materialization/certification/cutoff
   migration_wizard_sessions, migration_id_map
   accounting_sync_changes/runs, accounting_integration_logs

4. Transaction leaves (RESTRICT parents)
   payment_allocations, deposit_allocations, vendor_credit_applications, …
   *_lines → ledger_entries → documents → payments/invoices/bills/… → bank_* 

5. Masters
   customers, vendors, exchange_rates, cost_centers
   chart_of_accounts.parent_id = NULL → DELETE chart_of_accounts

6. Reset counters on preserved sequence tables
```

Hard RESTRICT edges that force this order include:

- `payment_allocations` → invoices/bills
- `deposit_allocations` → payments + COA
- `vendor_credit_*` → vendor_credits/bills/COA/items/cost_centers
- `ledger_entries` / `journal_lines` → COA
- `sales_receipt_lines` → COA / items / cost_centers
- `invoices.customer_id`, `bills.vendor_id`, etc.
- `tax_agencies.liability_account_id` → COA

## Sequences reset (tables preserved)

| Table | Reset |
|---|---|
| `document_sequences` | `next_number = starting_number` |
| `sequences` | `next_no = 1` |
| `posting_sequences` | `last_sequence = 0` |
| `numbering_series` | `next_number = 1` |

No PostgreSQL `SERIAL`/`IDENTITY` sequences need restart for UUID PKs.

## Script guarantees

- One `BEGIN` … `COMMIT` transaction; verification `RAISE EXCEPTION` aborts and rolls back.
- Idempotent: second run deletes 0 rows and still passes.
- Preserve-count snapshot compared after deletes.
- Asserts empty: customers, COA, import_jobs, job_queue, migration sessions, checkpoints, QB migration tables, etc.
- Asserts target company still exists.

## After you run it

1. Confirm NOTICE: `Operational reset OK…`
2. Reconnect QuickBooks OAuth to `05585a44-672d-4bab-aa40-6dfe022c19a0` (required for that tenant’s benchmark).
3. Run CLI / worker / wizard benchmarks against that empty tenant.
