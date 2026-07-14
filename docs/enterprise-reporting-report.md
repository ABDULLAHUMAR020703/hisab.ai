# Enterprise Reporting Framework

Migration `036_enterprise_reporting.sql` adds a unified reporting layer on top of the existing accounting engine. **All legacy `/api/reports/*` endpoints are preserved unchanged** — they continue to call the same calculation functions.

## Backward compatibility

| Legacy endpoint | Status |
|-----------------|--------|
| `/api/reports/trial-balance` | Unchanged — still calls `buildTrialBalance` |
| `/api/reports/balance-sheet` | Unchanged — `buildBalanceSheetFromLedger` |
| `/api/reports/profit-loss` | Unchanged — `buildProfitLossFromLedger` |
| `/api/reports/cash-flow` | Unchanged — `buildCashFlowFromLedger` |
| `/api/reports/general-ledger` | Unchanged — `getGeneralLedgerReport` |
| `/api/reports/aged-ar` | Same JSON shape — logic extracted to `aging.ts` |
| `/api/reports/aged-ap` | Same JSON shape — logic extracted to `aging.ts` |

New enterprise APIs live under `/api/reporting/*` and never replace legacy routes.

## Report framework (`src/lib/reporting/`)

| Module | Purpose |
|--------|---------|
| `types.ts` | Shared request/result types |
| `periods.ts` | Monthly, quarterly, yearly, YTD, custom, comparative periods |
| `builder.ts` | Filters, column selection, grouping, sorting, pagination, calculated columns |
| `registry.ts` | Catalog of 40+ report definitions |
| `runner.ts` | Orchestrates execution + 120s cache |
| `export.ts` | CSV, Excel, PDF, print export |
| `custom.ts` | Saved definition execution |
| `summaries.ts` | Daily materialized ledger summaries |
| `aging.ts` | Shared AR/AP aging (used by legacy + enterprise) |
| `providers/legacy.ts` | Wraps existing accounting builders |
| `providers/financial-extended.ts` | Comparative statements, ratios, budget vs actual, ledgers |
| `providers/operational.ts` | Sales, purchases, expenses, inventory, payroll, tax, top N |
| `providers/analytics.ts` | Executive dashboard, trends, turnover, variance |

## Report catalog (40+ reports)

### Financial (legacy + extended)
Trial Balance, Balance Sheet, P&L, Cash Flow, General Ledger, Aged AR/AP, Comparative P&L/BS, Retained Earnings, Equity Statement, Financial Ratios, Budget vs Actual, Journal Report, Customer/Vendor Ledger

### Operational
Sales/Purchase/Expense summaries, Inventory Valuation/Movement, Payroll, Tax, Bank, Top Customers/Vendors/Products, Cost Center, Department Profitability

### Analytics
Executive Dashboard, Revenue/Expense Trends, Cash Position, Working Capital, Profit Margins, Receivable/Payable/Inventory Turnover, Budget Variance

## APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/reporting/catalog` | List available reports |
| `GET/POST /api/reporting/run` | Run report with filters/columns/grouping/pagination |
| `POST /api/reporting/export` | Export CSV, Excel, PDF; email hook for schedules |
| `GET /api/reporting/analytics` | Executive dashboard + analytics reports |
| `GET/POST /api/reporting/definitions` | Custom saved reports |
| `GET/POST /api/reporting/schedules` | Scheduled delivery config |
| `POST /api/reporting/summaries/refresh` | Refresh materialized daily summaries |

## Database (migration 036)

- `report_definitions` — custom report designer output
- `report_templates` — saved layouts per report key
- `report_schedules` — scheduled export/email delivery
- `report_permissions` — per-user/role report access
- `report_daily_summaries` — materialized ledger aggregates
- Performance indexes on `ledger_entries`, `invoices`, `bills`, `expenses`

## UI

| Page | Path |
|------|------|
| Reports hub (additive section) | `/reports` |
| Enterprise report runner | `/reports/enterprise` |
| Executive analytics | `/reports/analytics` |
| Custom report builder | `/reports/builder` |

## Exports

CSV, Excel (xlsx), PDF (pdfkit), print (PDF). Email delivery is configured via schedules (SMTP hook placeholder).

## Performance

- 120s in-memory cache per report/company/params (extends existing `report-cache.ts`)
- `report_daily_summaries` for large ledger aggregation
- Composite indexes on ledger and document tables
- Pagination on tabular results (default 50–500 rows)
- PDF export truncates at 500 rows with notice

## Tests

`tests/reporting/enterprise.test.ts` — builder, periods, catalog, aging buckets.

Run: `npm run test:accounting`

## Setup

1. Apply migration `036_enterprise_reporting.sql`.
2. Open `/reports/enterprise` to run any catalog report.
3. Use `/reports/builder` to save custom layouts.
4. Optionally `POST /api/reporting/summaries/refresh` to populate daily summaries.

Legacy report pages and APIs continue to work exactly as before.
