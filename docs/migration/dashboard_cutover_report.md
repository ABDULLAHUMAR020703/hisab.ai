# Dashboard Cutover Report

Date: 2026-06-21

Status: read cutover complete through provider.

## Findings

- `GET /api/dashboard` uses `getDashboardRepository().getStats()`.
- Prisma and Supabase dashboard adapters both exist.
- Dashboard is read-only from the route perspective.

## Remaining Risk

- Dashboard values depend on modules that are still mixed-backend, especially payments, accounting, payroll, inventory writes, and invoice-adjacent payment routes.
- Global parity should be rerun after those modules are cut over.

