# Phase D5 — Write Parity Report

**Status:** Customer + vendor write cutover complete

See [`customer_vendor_write_cutover_report.md`](./customer_vendor_write_cutover_report.md) for full details.

## Completed

| Entity | Routes | Dual-write wired |
|--------|--------|------------------|
| Customer | POST/PUT/DELETE `/api/customers` | Yes (when `USE_SUPABASE=false` + `DUAL_WRITE=true`) |
| Vendor | POST/PUT/DELETE `/api/vendors` | Yes (when `USE_SUPABASE=false` + `DUAL_WRITE=true`) |
| Sequence | Inside customer/vendor `create()` | Yes via `SequenceRepository` |

## Pending write migration

| Entity | Routes | Status |
|--------|--------|--------|
| Invoice | POST/PUT/DELETE `/api/invoices` | Not started |
| Payment | POST `.../payment` | Not started |
| Expense | POST/PUT/DELETE `/api/expenses` | Not started |
| Inventory | POST/PUT/DELETE `/api/inventory` | Not started |
| Payroll | POST/PUT `/api/payroll` | Not started |

## Rollback

```bash
USE_SUPABASE=false
DUAL_WRITE=false
```
