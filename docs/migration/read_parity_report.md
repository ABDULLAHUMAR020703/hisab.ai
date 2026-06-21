# Phase D4 — Read Parity Report

**Date:** 2025-06-21  
**Mode:** `USE_SUPABASE=false`, `DB_PARITY_CHECK=true` (shadow reads)

## Architecture

| Layer | Location |
| ----- | -------- |
| Provider | `src/lib/db/provider.ts` |
| Parity | `src/lib/db/parity.ts` |
| Prisma adapters | `src/lib/db/repositories/*.repository.prisma.ts` |
| Supabase adapters | `src/lib/db/repositories/*.repository.supabase.ts` |

**Ignored fields in comparison:** `id`, `legacy_id`, `createdAt`, `updatedAt`, and foreign-key UUID fields (`customerId`, `vendorId`, etc.).

---

## Routes migrated (GET)

| Route | Provider | Parity wired |
| ----- | -------- | ------------ |
| `GET /api/settings` | `getSettingsRepository()` | ✅ |
| `GET /api/customers` | `getCustomerRepository()` | ✅ |
| `GET /api/customers/[id]` | `getCustomerRepository()` | ✅ |
| `GET /api/vendors` | `getVendorRepository()` | ✅ |
| `GET /api/vendors/[id]` | `getVendorRepository()` | ✅ |
| `GET /api/accounts` | `getAccountRepository()` | ✅ |
| `GET /api/accounts/[id]` | `getAccountRepository()` | ✅ |
| `GET /api/invoices` | `getInvoiceRepository()` | ✅ |
| `GET /api/invoices/[id]` | `getInvoiceRepository()` | ✅ |
| `GET /api/dashboard` | `getDashboardRepository()` | ✅ |
| `GET /api/inventory` | `getInventoryRepository()` | ✅ |
| `GET /api/inventory/[id]` | `getInventoryRepository()` | ✅ |
| `GET /api/payroll` | `getPayrollRepository()` | ✅ |
| `GET /api/payroll/[id]` | `getPayrollRepository()` | ✅ |
| ZATCA audit (via `/api/zatca/dashboard`) | `getAuditRepository().findRecent()` | ✅ |

**Write routes (POST/PUT/DELETE)** still use Prisma directly — D5 pending.

---

## Manual parity test

```bash
# .env
USE_SUPABASE=false
DB_PARITY_CHECK=true
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

npm run dev
```

Log in and hit each route, or use curl with session cookie. Watch server console:

- ✅ No output = parity pass
- ⚠️ `[DB parity mismatch]` = **STOP** — document below
- ⚠️ `[DB parity error]` = Supabase query failed (check env, RLS, import)

---

## Parity results

| Route | Tested | Result | Notes |
| ----- | ------ | ------ | ----- |
| Settings GET | Yes | PASS | No `[DB parity mismatch]` or `[DB parity error]` observed during manual run |
| Customers GET | Yes | PASS | No mismatch/error observed |
| Customers [id] GET | Yes | PASS | Supabase resolves `legacy_id`; no mismatch/error observed |
| Vendors GET | Yes | PASS | No mismatch/error observed |
| Accounts GET | Yes | PASS | No mismatch/error observed |
| Invoices GET | Yes | PASS | Includes lines + ZATCA fields; no mismatch/error observed |
| Invoices [id] GET | Yes | PASS | Includes customer, lines, payments; no mismatch/error observed |
| Dashboard GET | Yes | PASS | No mismatch/error observed |
| Inventory GET | Yes | PASS | No mismatch/error observed |
| Payroll GET | Yes | PASS | No mismatch/error observed |
| Audit logs | Yes | PASS | Via ZATCA dashboard; no mismatch/error observed |

> **STOP rule:** If business fields mismatch (amounts, status, invoice hash, customer name, etc.), halt D5 and fix mapper/repository before continuing.

---

## Known acceptable diffs

| Field / area | Cause |
| ------------ | ----- |
| Primary keys | cuid (SQLite) vs UUID (Supabase) — ignored |
| Timestamps | Sub-second drift — ignored |
| Dashboard `counts.users` | Prisma `User` table vs Supabase `company_users` — investigate if counts differ |
| JSON metadata | Prisma string vs Supabase JSONB — normalized in mappers |

---

## Rollback

```bash
USE_SUPABASE=false
DB_PARITY_CHECK=false
```

No data mutation during read parity.
