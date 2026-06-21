# Prisma Removal Readiness

Date: 2026-06-21

Status: not ready.

## Remaining Prisma Usages

- Repository rollback adapters
- Auth and `AppSession`
- Bills and payments
- Accounting writes and reports
- Inventory writes
- Payroll and employees
- Users
- Invoice payment/PDF
- ZATCA services
- Seed, QA, demo, migration, and validation scripts

## Remaining SQLite Usages

- `prisma/schema.prisma`
- `prisma/dev.db`
- `src/lib/prisma.ts`
- `src/lib/sqlite-db.ts`
- SQLite build/seed/sync scripts
- `better-sqlite3` dependencies

## Blockers

Blockers > 0. Do not remove Prisma.

