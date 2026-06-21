# Phase D5 — Customer + Vendor Write Cutover Report

**Date:** 2025-06-21  
**Scope:** Customer and vendor create/update/delete via repository layer only

---

## Summary

| Area | Before | After |
|------|--------|-------|
| Customer GET | Supabase via provider | Unchanged |
| Customer POST/PUT/DELETE | Direct `prisma.customer.*` | `getCustomerRepository()` |
| Vendor GET | Supabase via provider | Unchanged |
| Vendor POST/PUT/DELETE | Direct `prisma.vendor.*` | `getVendorRepository()` |
| Sequence numbering | Direct `prisma.sequence` in routes | `SequenceRepository` inside customer/vendor repos |
| Dual-write | Infra only | Wired for customer/vendor when `USE_SUPABASE=false` + `DUAL_WRITE=true` |

With `USE_SUPABASE=true` (default), all customer/vendor reads and writes go to **Supabase only**.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/db/repositories/customer.repository.interface.ts` | Added `create`, `update`, `delete` |
| `src/lib/db/repositories/customer.repository.prisma.ts` | Implemented write methods + sequence |
| `src/lib/db/repositories/customer.repository.supabase.ts` | Implemented write methods + soft delete |
| `src/lib/db/repositories/vendor.repository.interface.ts` | Added `create`, `update`, `delete` |
| `src/lib/db/repositories/vendor.repository.prisma.ts` | Implemented write methods + sequence |
| `src/lib/db/repositories/vendor.repository.supabase.ts` | Implemented write methods + soft delete |
| `src/lib/db/repositories/sequence.repository.interface.ts` | **New** |
| `src/lib/db/repositories/sequence.repository.prisma.ts` | **New** |
| `src/lib/db/repositories/sequence.repository.supabase.ts` | **New** |
| `src/lib/db/sequence-resolver.ts` | **New** — avoids circular deps |
| `src/lib/db/provider.ts` | Write methods + `getSequenceRepository()` |
| `src/lib/sequences.ts` | Delegates to `resolveSequenceRepository()` |
| `src/app/api/customers/route.ts` | POST via repository |
| `src/app/api/customers/[id]/route.ts` | PUT/DELETE via repository |
| `src/app/api/vendors/route.ts` | POST via repository |
| `src/app/api/vendors/[id]/route.ts` | PUT/DELETE via repository |
| `scripts/db/test-customer-vendor-write.ts` | **New** — D5 CRUD validation |
| `package.json` | Added `db:test-customer-vendor-write` script |

---

## Routes migrated

| Route | Method | Provider | Backend (`USE_SUPABASE=true`) |
|-------|--------|----------|-------------------------------|
| `/api/customers` | GET | `getCustomerRepository().findMany` | Supabase |
| `/api/customers` | POST | `getCustomerRepository().create` | Supabase |
| `/api/customers/[id]` | GET | `getCustomerRepository().findById` | Supabase |
| `/api/customers/[id]` | PUT | `getCustomerRepository().update` | Supabase |
| `/api/customers/[id]` | DELETE | `getCustomerRepository().delete` | Supabase (soft delete) |
| `/api/vendors` | GET | `getVendorRepository().findMany` | Supabase |
| `/api/vendors` | POST | `getVendorRepository().create` | Supabase |
| `/api/vendors/[id]` | GET | `getVendorRepository().findById` | Supabase |
| `/api/vendors/[id]` | PUT | `getVendorRepository().update` | Supabase |
| `/api/vendors/[id]` | DELETE | `getVendorRepository().delete` | Supabase (soft delete) |

No direct `prisma.customer.*` or `prisma.vendor.*` in customer/vendor API routes.

---

## Sequence generation

```
Customer/Vendor create()
  └─ resolveSequenceRepository().next(type, prefix)
       ├─ USE_SUPABASE=true  → supabaseSequenceRepository → public.sequences
       └─ USE_SUPABASE=false → prismaSequenceRepository → prisma.sequence
```

Legacy `getNextSequence()` in `src/lib/sequences.ts` still works for other modules (invoices, bills, etc.) via the same resolver.

---

## Dual-write mode

When:

```bash
USE_SUPABASE=false
DUAL_WRITE=true
```

Provider wraps customer/vendor write methods:

1. Write Prisma (primary)
2. Write Supabase (shadow)
3. Compare normalized result
4. Log `[DB dual-write mismatch]` or `[DB dual-write error]`

Note: create operations may log mismatches on `id` / numbering because each backend allocates its own sequence independently during dual-write validation.

---

## Validation

Run:

```bash
npm run db:test-customer-vendor-write
```

Checks:

- Create customer → visible in `findMany`
- Update customer → name persists
- Delete customer → not in `findById`
- Create vendor → visible in `findMany`
- Update vendor → name persists
- Delete vendor → not in `findById`

---

## Parity results

| Test | Result | Notes |
|------|--------|-------|
| Build (`npm run build`) | **PASS** | TypeScript + Next.js compile OK |
| Repository CRUD script (`npm run db:test-customer-vendor-write`) | **PASS** | `USE_SUPABASE=true`, Supabase backend |
| Customer create → immediate read | **PASS** | `CUST-00103` visible in `findMany` |
| Customer update | **PASS** | Name persisted |
| Customer delete | **PASS** | Soft delete; `findById` returns null |
| Vendor create → immediate read | **PASS** | `VEND-00023` visible in `findMany` |
| Vendor update | **PASS** | Name persisted |
| Vendor delete | **PASS** | Soft delete; `findById` returns null |

---

## Rollback

```bash
USE_SUPABASE=false
DB_PARITY_CHECK=false
DUAL_WRITE=false
```

Customer/vendor routes will use Prisma repositories again. Prisma schema and SQLite file remain intact.

---

## Not in scope

- Invoice write cutover
- ZATCA services
- Auth cutover
- Prisma removal (Phase E)
