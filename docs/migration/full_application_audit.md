# Full Application Audit

Date: 2026-06-21

## Summary

The application is in a partial Supabase cutover state. Supabase is the default runtime through `USE_SUPABASE=true`, but Prisma/SQLite remains the rollback and shadow backend. Customers, vendors, settings, dashboard reads, and invoice CRUD now route through repository providers. Many accounting, payment, inventory write, payroll write, report, auth, seed, and ZATCA paths still use Prisma directly.

## Provider Layer

- `src/lib/db/provider.ts` exposes repository resolution.
- `USE_SUPABASE=false` keeps Prisma primary.
- `DB_PARITY_CHECK=true` wraps configured read methods.
- `DUAL_WRITE=true` wraps configured write methods.
- Invoice writes are now registered for dual write: `create`, `update`, `delete`.

## Direct Prisma Imports

Direct Prisma remains in these main areas:

- Auth: `src/lib/auth.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- Accounting routes: accounts writes, cost centers, journal, receipts, tax, reports
- Bills and payments: bills CRUD/import/payment, invoice payment route
- Inventory writes: `src/app/api/inventory/*`
- Payroll writes: `src/app/api/payroll/*`, `src/app/api/employees/*`
- Users: `src/app/api/users/*`
- Reports: balance sheet, cash flow, general ledger, profit/loss, tax report
- Seeds and QA/demo data: `src/app/api/seed/route.ts`, `src/lib/demo-seed.ts`, `src/lib/qa-seed.ts`, `prisma/seed.ts`
- ZATCA services: invoice service, hashing, submission, onboarding, audit logger, monitoring, sandbox runner
- Repository rollback adapters: `src/lib/db/repositories/*.prisma.ts`

## SQLite Dependencies

SQLite remains intentionally present:

- `prisma/schema.prisma` uses `provider = "sqlite"`.
- `src/lib/prisma.ts` creates a `PrismaBetterSqlite3` adapter.
- `src/lib/sqlite-db.ts` resolves `prisma/dev.db`.
- `package.json` includes `better-sqlite3`, `@prisma/adapter-better-sqlite3`, `build:sqlite`, and `db:sqlite-sync`.
- Migration scripts still export and validate SQLite data.

## Direct Supabase Access

Direct Supabase access is mostly contained in repository/helper modules:

- `src/lib/db/repositories/*.supabase.ts`
- `src/lib/db/company.repository.ts`
- `src/lib/db/settings.repository.ts`
- `src/lib/db/user.repository.ts`
- `src/lib/db/zatca.repository.ts`
- `src/lib/db/repository-utils.ts`

## Routes Bypassing Repositories

Routes still bypassing repositories include bills, payments, cost centers, journal, expenses, receipts, tax, reports, users, employee/payroll writes, seed, invoice payment/PDF, and selected ZATCA endpoints.

## Services Bypassing Repositories

Services still bypassing repositories include:

- `src/lib/zatca/invoice-service.ts`
- `src/lib/zatca/hash/previous.ts`
- `src/lib/zatca/hash/counter.ts`
- `src/lib/zatca/submission/*`
- `src/lib/zatca/onboarding/*`
- `src/lib/zatca/testing/sandbox-runner.ts`
- `src/lib/zatca/monitoring/dashboard.ts`
- `src/lib/zatca/audit/logger.ts`
- `src/lib/demo-seed.ts`
- `src/lib/qa-seed.ts`

## Auth Dependencies

Auth remains on legacy Prisma-backed `AppSession`:

- `getSession()` reads the `session` cookie.
- `prisma.appSession.findUnique()` loads sessions.
- `requireAuth()` is used by most API routes.
- Login/logout create/delete `AppSession` rows.

Decision needed after auth audit: retain legacy auth during cutover or migrate to Supabase Auth.

