# Invoice Cutover Report

Date: 2026-06-21

## Completed

- Added `create()`, `update()`, and `delete()` to `InvoiceRepository`.
- Implemented Prisma adapter write methods for rollback mode.
- Implemented Supabase adapter write methods for default runtime.
- Moved invoice number generation into the repository via `resolveSequenceRepository().next('INVOICE', 'INV-')`.
- Moved line subtotal/tax/total/balance calculations into repository adapters.
- Refactored `POST /api/invoices`, `PUT /api/invoices/[id]`, and `DELETE /api/invoices/[id]` to call the repository only.
- Registered invoice write methods in provider dual-write support.
- Supabase invoice delete is soft delete through `deleted_at`.
- Supabase writes resolve legacy IDs to Supabase UUIDs for customers, accounts, cost centers, and created-by profiles.

## ZATCA Preservation

The write adapters do not update these fields during normal invoice edits:

- `invoice_uuid`, except generated once on create
- `invoice_hash`
- `previous_invoice_hash`
- `signed_xml`
- `cleared_invoice_payload`
- `zatca_status`
- `clearance_status`
- response/request fields
- `created_at`

## Current Invoice Route State

- `GET /api/invoices`: provider repository
- `POST /api/invoices`: provider repository
- `GET /api/invoices/[id]`: provider repository
- `PUT /api/invoices/[id]`: provider repository
- `DELETE /api/invoices/[id]`: provider repository

No direct `prisma.invoice.*` or `prisma.invoiceLine.*` remains in the invoice CRUD routes.

## Remaining Invoice-Adjacent Blockers

- `POST /api/invoices/[id]/payment` still uses Prisma and must move during payment cutover.
- `GET /api/invoices/[id]/pdf` still uses Prisma and must move before final Prisma removal.
- ZATCA invoice services still use Prisma and must remain audit-only until invoice cutover is runtime-validated.

## Validation

- `npx tsc --noEmit` passed.
- Static scan found no direct Prisma, `invoiceLine`, `getNextSequence`, or `randomUUID` use in `src/app/api/invoices/route.ts` or `src/app/api/invoices/[id]/route.ts`.

