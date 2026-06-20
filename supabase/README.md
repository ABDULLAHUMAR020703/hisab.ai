# Supabase — hisab.ai

PostgreSQL schema and seeds for Supabase. Applied in numeric order.

## Migrations (`migrations/`)

| File | Purpose |
|------|---------|
| `001_extensions.sql` | `pgcrypto`, `set_updated_at()` |
| `002_enums.sql` | Domain enums |
| `003_companies.sql` | Companies, settings, ZATCA credential tables |
| `004_auth_profiles.sql` | Profiles, preferences, invitations |
| `005_company_users.sql` | Membership + RLS helpers |
| `006_accounting_core.sql` | GL, sequences, tax, expenses, payroll, inventory, receipts |
| `007_customers_vendors.sql` | Customers, vendors, bills |
| `008_invoices.sql` | Invoices, lines, payments (full ZATCA columns) |
| `009_zatca_core.sql` | Audit logs, sandbox runs, XML archive, API logs |
| `010_database_hardening.sql` | CHECK constraints |
| `011_rls_tenant_integrity.sql` | Composite FKs, RLS hardening |
| `012_migration_validation.sql` | Read-only validation queries (run in SQL editor) |
| `013_migration_id_map.sql` | Phase C ID traceability table |

## Seed (`seed/`)

| File | Purpose |
|------|---------|
| `001_default_company.sql` | Default tenant shell (required before Phase C import) |

Legacy monolithic SQL (reference only): [docs/migration/archive/legacy_prisma_mirror.sql](../docs/migration/archive/legacy_prisma_mirror.sql)

## Apply

```bash
npm run supabase:migrate    # apply migrations 001–013
npm run supabase:seed       # default company tenant only
npm run supabase:verify     # table counts
```

Phase C data load: [docs/migration/014_phase_c_runbook.md](../docs/migration/014_phase_c_runbook.md)
