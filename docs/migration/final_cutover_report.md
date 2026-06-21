# Phase D6–D12, E, F — Status

**Migration is NOT complete.** This document tracks remaining work.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **D4** | Read cutover | ✅ Code complete — manual parity passed |
| **D5** | Write dual-write | ⏳ Infra only |
| **D6** | Accounting (journal, cost centers, tax, receipts) | ⏳ Not started |
| **D7** | Inventory transactions | ⏳ Not started |
| **D8** | Payroll write workflows | ⏳ Not started |
| **D9** | ZATCA readiness audit | 📋 Checklist in `zatca_readiness_report.md` |
| **D10** | ZATCA service cutover | ⏳ Not started — do not change ZATCA logic until D9 passes |
| **D11** | Auth cutover | 📋 Plan in `auth_cutover_plan.md` |
| **D12** | `USE_SUPABASE=true` runtime mode | 🟡 Supabase-first runtime enabled; full D12 still blocked on D5–D11 |
| **E** | Prisma removal | ⏳ Blocked — Prisma kept for rollback |
| **F** | Production readiness | ⏳ Blocked |

See also:

- `accounting_parity_report.md` (placeholder)
- `inventory_parity_report.md` (placeholder)
- `payroll_parity_report.md` (placeholder)
- `zatca_parity_report.md` (placeholder)
- `global_cutover_report.md` (placeholder)
- `prisma_removal_report.md` (placeholder)
- `production_readiness_report.md` (placeholder)
- `final_migration_completion_report.md` (master status)
