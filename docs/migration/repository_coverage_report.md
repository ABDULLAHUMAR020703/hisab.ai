# Repository Coverage Report

Date: 2026-06-21

| Entity | Interface | Prisma adapter | Supabase adapter | CRUD complete | Notes |
|---|---|---|---|---|---|
| customers | yes | yes | yes | yes | Routed through provider. |
| vendors | yes | yes | yes | yes | Routed through provider. |
| invoices | yes | yes | yes | yes | CRUD added in this cutover. Payment/PDF/ZATCA invoice paths still separate. |
| payments | no | no | no | no | Payment routes still Prisma. |
| expenses | no | no | no | no | Expense routes still Prisma. |
| accounting accounts | yes | yes | yes | read-only | Writes still in routes for accounts, journals, cost centers, tax, receipts. |
| inventory | yes | yes | yes | read-only | Creates/updates/deletes still Prisma in routes. |
| payroll | yes | yes | yes | read-only | Creates/updates/approve still Prisma in routes. |
| dashboard | yes | yes | yes | read-only | Routed through provider. |
| users | partial helpers | no provider adapter | Supabase helper functions | no | Auth/users still Prisma route-backed. |
| companies | helper functions | no | yes | partial | Supabase helpers only, not provider pair. |
| settings | yes | yes | yes | create/update/upsert | Routed through provider. |
| ZATCA credentials/onboarding | helper functions | no provider adapter | Supabase helper functions | partial | ZATCA services still mostly Prisma; audit-only for now. |
| audit logs | yes | yes | yes | read-only | Logger still writes Prisma directly. |
| sequences | yes | yes | yes | next only | Used by customer, vendor, invoice repositories. |

