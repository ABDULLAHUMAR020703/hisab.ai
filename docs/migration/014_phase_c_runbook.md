# Phase C — SQLite → Supabase Data Migration Runbook

**Scripts:** `scripts/db/migration/014_*` through `017_*`  
**SQL:** `supabase/migrations/013_migration_id_map.sql`  
**Staging:** `data/migration/` (gitignored — contains export + ID map)

---

## Prerequisites

1. Supabase migrations `001`–`012` applied
2. Apply migration `013_migration_id_map.sql`:
   ```bash
   npm run supabase:migrate
   ```
3. Seed default tenant:
   ```bash
   npm run supabase:seed
   ```
4. Environment variables:
   ```bash
   SUPABASE_DATABASE_URL=postgresql://...   # or DIRECT_URL / DATABASE_URL
   SUPABASE_URL=https://xxx.supabase.co       # optional — auth user creation
   SUPABASE_SERVICE_ROLE_KEY=...              # optional — auth user creation
   MIGRATION_USER_PASSWORD=YourSecurePass     # optional — default for migrated users
   ZATCA_CREDENTIAL_ENCRYPTION_KEY=...        # must match SQLite runtime key
   ```
5. Backup:
   - Copy `prisma/dev.db` → `prisma/dev.db.backup-<date>`
   - Supabase point-in-time snapshot or `pg_dump`

---

## Execution order

| Step | Command | Output |
|------|---------|--------|
| **0** | Apply `013_migration_id_map.sql` | `public.migration_id_map` table |
| **1** | `npm run migrate:export` | `data/migration/export/*.json` + `manifest.json` |
| **2** | `npm run migrate:id-map` | `data/migration/migration_id_map.json` |
| **3** | `npm run migrate:import` | Supabase rows + `migration_id_map` populated |
| **4** | `npm run migrate:validate` | Pass/fail report |
| **5** | Run `012_migration_validation.sql` in Supabase SQL editor | Schema/RLS/FK checks |

Dry-run import (no writes):

```bash
npx tsx scripts/db/migration/016_import_supabase.ts --dry-run
```

Custom SQLite path:

```bash
npx tsx scripts/db/migration/014_export_sqlite.ts --db path/to/dev.db
npx tsx scripts/db/migration/017_validate_migration.ts --db path/to/dev.db
```

---

## What each script does

### `014_export_sqlite.ts`

Reads `prisma/dev.db` via better-sqlite3. Exports all Prisma business tables (skips `AppSession`) to JSON. Preserves raw field values including encrypted blobs and timestamps.

### `015_generate_id_map.ts`

Builds deterministic UUIDv5 map:

```
namespace = 00000000-0000-4000-8000-000000000099
uuid      = v5("hisab:{EntityType}:{legacy_cuid}", namespace)
```

`CompanySettings.id` → fixed seed `00000000-0000-4000-8000-000000000001`.

### `016_import_supabase.ts`

Single transaction import in dependency order:

1. Company + ZATCA settings (UPDATE seed row)
2. Auth users + profiles + company_users
3. Reference → parties → GL → AR/AP → payroll → ZATCA
4. `migration_id_map` table

Preserves verbatim: `invoice_uuid`, `invoice_hash`, `previous_invoice_hash`, `created_at`, `*Enc` ciphertext, CSIDs.

Parses JSON strings → JSONB: `metadata`, `steps`, `zatca_response_payload`, `cleared_invoice_payload`.

### `017_validate_migration.ts`

Compares SQLite vs Supabase:

- Row counts per table
- `migration_id_map` completeness
- Invoice UUID/hash/PIH/`created_at` parity
- ZATCA credential CSID + encrypted field lengths
- Sequence `next_no` parity

---

## Rollback strategy

### Before rollback

Save: export folder, `migration_id_map.json`, validation output, `pg_dump`.

### Option A — Tenant-scoped DELETE (reverse dependency)

Replace `:tenant` with `00000000-0000-4000-8000-000000000001`:

```sql
BEGIN;
DELETE FROM public.migration_id_map;
DELETE FROM public.zatca_sandbox_test_runs WHERE legacy_id IS NOT NULL;
DELETE FROM public.zatca_audit_logs WHERE legacy_id IS NOT NULL;
DELETE FROM public.zatca_onboarding_requests WHERE company_id = :tenant;
DELETE FROM public.zatca_credentials WHERE company_id = :tenant;
DELETE FROM public.payroll_lines WHERE legacy_id IS NOT NULL;
DELETE FROM public.payroll_entries WHERE legacy_id IS NOT NULL;
DELETE FROM public.payments WHERE legacy_id IS NOT NULL;
DELETE FROM public.invoice_lines WHERE legacy_id IS NOT NULL;
DELETE FROM public.invoices WHERE legacy_id IS NOT NULL;
DELETE FROM public.bill_lines WHERE legacy_id IS NOT NULL;
DELETE FROM public.bills WHERE legacy_id IS NOT NULL;
DELETE FROM public.expense_lines WHERE legacy_id IS NOT NULL;
DELETE FROM public.expenses WHERE legacy_id IS NOT NULL;
DELETE FROM public.journal_lines WHERE legacy_id IS NOT NULL;
DELETE FROM public.journal_entries WHERE legacy_id IS NOT NULL;
DELETE FROM public.receipts WHERE legacy_id IS NOT NULL;
DELETE FROM public.inventory_items WHERE legacy_id IS NOT NULL;
DELETE FROM public.employees WHERE legacy_id IS NOT NULL;
DELETE FROM public.vendors WHERE legacy_id IS NOT NULL;
DELETE FROM public.customers WHERE legacy_id IS NOT NULL;
DELETE FROM public.sequences WHERE legacy_id IS NOT NULL;
DELETE FROM public.tax_rates WHERE legacy_id IS NOT NULL;
DELETE FROM public.cost_centers WHERE legacy_id IS NOT NULL;
DELETE FROM public.chart_of_accounts WHERE legacy_id IS NOT NULL;
-- Remove migrated auth users manually via Supabase dashboard if needed
COMMIT;
```

### Option B — Full restore

Restore `pg_dump` snapshot taken before Step 3.

### Re-run safety

Deterministic UUIDs + `ON CONFLICT` upserts allow idempotent re-import after rollback DELETE.

---

## Validation process

1. **`npm run migrate:validate`** — must exit 0
2. **`012_migration_validation.sql`** — all sections PASS
3. Manual spot checks:
   - Login as migrated user (`MIGRATION_USER_PASSWORD`)
   - Decrypt one SANDBOX credential in app/settings
   - Verify invoice hash chain order unchanged
4. Sign-off checklist in `013_data_migration_plan.md`

---

## `migration_id_map` table

| Column | Type | Description |
|--------|------|-------------|
| `entity_type` | TEXT | Prisma model name (e.g. `Invoice`) |
| `legacy_id` | TEXT | Original cuid |
| `supabase_id` | UUID | Deterministic UUIDv5 |
| `created_at` | TIMESTAMPTZ | Source row `createdAt` or map generation time |

Primary key: `(entity_type, legacy_id)`

Query example:

```sql
SELECT entity_type, count(*) FROM public.migration_id_map GROUP BY 1 ORDER BY 1;
```
