# Phase D — Dependency Audit (D1)

**Date:** 2025-06-21  
**Scope:** All Prisma imports, `PrismaClient` usage, direct DB calls, and existing Supabase repositories.

## Summary

| Category | Files | Notes |
| -------- | ----- | ----- |
| API routes (direct `prisma`) | 42 | Primary cutover surface |
| ZATCA services (direct `prisma`) | 14 | Cutover in D9–D10 only |
| Auth / sessions | 3 | D11 (plan only) |
| Seed / QA / demo | 5 | Stay on Prisma (rollback path) |
| Type-only `@prisma/client` imports | 12 | Replace with `src/lib/db/types` over time |
| Infrastructure | 2 | `prisma.ts`, `sequences.ts` |

**Total Prisma runtime touchpoints:** ~66 files  
**Supabase repositories implemented:** 4 modules (`company`, `settings`, `user`, `zatca`)

## Feature flags

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `USE_SUPABASE` | `false` | Primary data source when `true` |
| `DB_PARITY_CHECK` | `false` | Shadow-read Supabase while Prisma is primary |

Routes must use `src/lib/db/provider.ts` — never branch on env vars directly.

---

## Full dependency table

| File | Prisma Usage | Repository Exists? | Migration Priority |
| ---- | ------------ | ------------------ | ------------------ |
| `src/lib/prisma.ts` | `PrismaClient` factory (SQLite/PG) | N/A (infra) | Keep — rollback |
| `src/lib/sequences.ts` | `sequence.findUnique/create/update` | No | P2 (D5/D6) |
| `src/lib/database.ts` | URL helpers | N/A | Keep |
| `src/lib/sqlite-db.ts` | SQLite path resolution | N/A | Keep |
| **Auth** | | | |
| `src/lib/auth.ts` | `appSession.findUnique` + user include | Partial (`user.repository`) | P8 (D11) |
| `src/app/api/auth/login/route.ts` | `user`, `appSession` CRUD | Partial | P8 (D11) |
| `src/app/api/auth/logout/route.ts` | `appSession.deleteMany` | No | P8 (D11) |
| **Settings & company** | | | |
| `src/app/api/settings/route.ts` | `companySettings` find/create/update | **Yes** (`settings`) | **P1 — migrated (D4)** |
| `src/lib/seed/company-settings.ts` | `companySettings` seed | **Yes** | P9 (seed scripts) |
| **Dashboard & reports** | | | |
| `src/app/api/dashboard/route.ts` | Aggregates across 15+ models | No | P1 (D4) |
| `src/app/api/reports/balance-sheet/route.ts` | `chartOfAccount`, `invoice`, `bill` | No | P3 (D6) |
| `src/app/api/reports/profit-loss/route.ts` | GL aggregates | No | P3 (D6) |
| `src/app/api/reports/general-ledger/route.ts` | `journalLine` joins | No | P3 (D6) |
| `src/app/api/reports/cash-flow/route.ts` | Payment/invoice aggregates | No | P3 (D6) |
| `src/app/api/tax/route.ts` | `taxRate` CRUD | No | P3 (D6) |
| `src/app/api/tax/report/route.ts` | Tax report queries | No | P3 (D6) |
| **Customers & vendors** | | | |
| `src/app/api/customers/route.ts` | `customer` findMany/create | No | P1 (D4 read), P2 (D5 write) |
| `src/app/api/customers/[id]/route.ts` | `customer` CRUD + invoices | No | P1/P2 |
| `src/app/api/vendors/route.ts` | `vendor` findMany/create | No | P1/P2 |
| `src/app/api/vendors/[id]/route.ts` | `vendor` CRUD | No | P1/P2 |
| **Accounts & journal** | | | |
| `src/app/api/accounts/route.ts` | `chartOfAccount` findMany/create | No | P1 (D4), P3 (D6) |
| `src/app/api/accounts/[id]/route.ts` | `chartOfAccount` CRUD | No | P3 (D6) |
| `src/app/api/journal/route.ts` | `journalEntry` + lines | No | P3 (D6) |
| `src/app/api/journal/[id]/route.ts` | `journalEntry` CRUD | No | P3 (D6) |
| `src/app/api/journal/[id]/post/route.ts` | Post workflow | No | P3 (D6) |
| `src/app/api/journal/import/route.ts` | Bulk journal import | No | P3 (D6) |
| `src/app/api/cost-centers/route.ts` | `costCenter` CRUD | No | P3 (D6) |
| `src/app/api/cost-centers/[id]/route.ts` | `costCenter` CRUD | No | P3 (D6) |
| **Invoices & AR** | | | |
| `src/app/api/invoices/route.ts` | `invoice` + lines create/list | No | P1 (D4 GET), P2 (D5) |
| `src/app/api/invoices/[id]/route.ts` | `invoice` CRUD + lines | No | P1/P2 |
| `src/app/api/invoices/[id]/payment/route.ts` | `payment`, `invoice` update | No | P2 (D5) |
| `src/app/api/invoices/[id]/pdf/route.ts` | `invoice` + settings read | No | P1 (D4) |
| **Bills & AP** | | | |
| `src/app/api/bills/route.ts` | `bill` + lines | No | P2 (D5) |
| `src/app/api/bills/[id]/route.ts` | `bill` CRUD | No | P2 (D5) |
| `src/app/api/bills/[id]/payment/route.ts` | `payment`, `bill` update | No | P2 (D5) |
| `src/app/api/bills/import/route.ts` | Bulk bill import | No | P2 (D5) |
| **Expenses** | | | |
| `src/app/api/expenses/route.ts` | `expense` + lines | No | P2 (D5) |
| `src/app/api/expenses/[id]/route.ts` | `expense` CRUD | No | P2 (D5) |
| `src/app/api/expenses/import/route.ts` | Bulk import | No | P2 (D5) |
| **Payroll & HR** | | | |
| `src/app/api/employees/route.ts` | `employee` CRUD | No | P4 (D7/D8) |
| `src/app/api/employees/[id]/route.ts` | `employee` CRUD | No | P4 (D8) |
| `src/app/api/payroll/route.ts` | `payrollEntry` + lines | No | P5 (D8) |
| `src/app/api/payroll/[id]/route.ts` | `payrollEntry` CRUD | No | P5 (D8) |
| `src/app/api/payroll/[id]/approve/route.ts` | Approve workflow | No | P5 (D8) |
| **Inventory & receipts** | | | |
| `src/app/api/inventory/route.ts` | `inventoryItem` CRUD | No | P4 (D7) |
| `src/app/api/inventory/[id]/route.ts` | `inventoryItem` CRUD | No | P4 (D7) |
| `src/app/api/receipts/route.ts` | `receipt` CRUD | No | P3 (D6) |
| `src/app/api/receipts/[id]/route.ts` | `receipt` CRUD | No | P3 (D6) |
| **Users** | | | |
| `src/app/api/users/route.ts` | `user` findMany/create | Partial | P8 (D11) |
| `src/app/api/users/[id]/route.ts` | `user` CRUD | Partial | P8 (D11) |
| **Seed / QA** | | | |
| `src/app/api/seed/route.ts` | Full chart/sequence seed | No | P9 — keep Prisma |
| `src/lib/demo-seed.ts` | Demo data | No | P9 |
| `src/lib/demo-users.ts` | Demo users | No | P9 |
| `src/lib/qa-seed.ts` | QA profiles | No | P9 |
| **ZATCA — onboarding** | | | |
| `src/lib/zatca/onboarding/service.ts` | `companySettings` update | **Yes** (settings) | P6 (D9 audit, D10 cutover) |
| `src/lib/zatca/onboarding/credential-store.ts` | `zatcaCredential` upsert | **Yes** (zatca) | P6 (D10) |
| `src/lib/zatca/onboarding/onboard.ts` | Settings + credentials | **Yes** | P6 (D10) |
| `src/lib/zatca/onboarding/compliance-checks.ts` | Invoice fixtures | No | P6 (D10) |
| `src/app/api/zatca/onboarding/status/route.ts` | Settings read | **Yes** | P1 (D4) |
| `src/app/api/zatca/onboarding/test-connection/route.ts` | Settings read | **Yes** | P1 (D4) |
| `src/app/api/zatca/onboard/route.ts` | Onboarding orchestration | Partial | P6 (D10) |
| **ZATCA — invoice pipeline** | | | |
| `src/lib/zatca/invoice-service.ts` | `invoice`, `companySettings` | Partial | P6 (D10) |
| `src/lib/zatca/hash/previous.ts` | `invoice` hash chain | No | P6 (D9/D10) |
| `src/lib/zatca/hash/counter.ts` | `invoice.count` | No | P6 (D9/D10) |
| `src/lib/zatca/submission/submit.ts` | Invoice update + submit | No | P6 (D10) |
| `src/lib/zatca/submission/status.ts` | Invoice + settings read | Partial | P6 (D10) |
| `src/lib/zatca/audit/logger.ts` | `zatcaAuditLog` create | No | P6 (D9/D10) |
| `src/lib/zatca/monitoring/dashboard.ts` | Invoice status counts | No | P6 (D10) |
| `src/lib/zatca/testing/sandbox-runner.ts` | Test run persistence | No | P6 (D10) |
| `src/app/api/zatca/invoices/[id]/*` (8 routes) | Invoice XML/hash/submit | No | P6 (D10) |
| **Type-only imports** | | | |
| `src/lib/invoices/pdf.ts` | Types only | N/A | P1 — swap types |
| `src/lib/zatca/qr/generator.ts` | `InvoiceType` type | N/A | P6 |
| `src/lib/zatca/api/*.ts` (5 files) | `ZatcaEnvironment` type | N/A | P6 |
| `src/lib/zatca/onboarding/*.ts` (6 files) | Prisma types | N/A | P6 |
| `src/lib/zatca/submission/router.ts` | `InvoiceType` type | N/A | P6 |
| `src/lib/zatca/validation/hardening.ts` | `InvoiceType` type | N/A | P6 |

---

## Prisma models vs Supabase tables

| Prisma Model | Supabase Table | Repository |
| ------------ | -------------- | ---------- |
| `CompanySettings` | `companies` + `company_settings` + `company_zatca_settings` | **Yes** |
| `User` | `profiles` + `auth.users` | Partial |
| `AppSession` | (legacy — Supabase Auth later) | No |
| `ChartOfAccount` | `chart_of_accounts` | No |
| `CostCenter` | `cost_centers` | No |
| `JournalEntry` / `JournalLine` | `journal_entries` / `journal_lines` | No |
| `Customer` | `customers` | No |
| `Vendor` | `vendors` | No |
| `Invoice` / `InvoiceLine` | `invoices` / `invoice_lines` | No |
| `Bill` / `BillLine` | `bills` / `bill_lines` | No |
| `Expense` / `ExpenseLine` | `expenses` / `expense_lines` | No |
| `Payment` | `payments` | No |
| `Employee` | `employees` | No |
| `PayrollEntry` / `PayrollLine` | `payroll_entries` / `payroll_lines` | No |
| `InventoryItem` | `inventory_items` | No |
| `TaxRate` | `tax_rates` | No |
| `Receipt` | `receipts` | No |
| `Sequence` | `sequences` | No |
| `ZatcaCredential` | `zatca_credentials` | **Yes** |
| `ZatcaOnboardingRequest` | `zatca_onboarding_requests` | **Yes** |
| `ZatcaAuditLog` | `zatca_audit_logs` | No |
| `ZatcaSandboxTestRun` | `zatca_sandbox_test_runs` | No |

---

## Rollback

Set `USE_SUPABASE=false` (default). All routes fall back to Prisma/SQLite with no schema changes required.
