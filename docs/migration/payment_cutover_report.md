# Payment Cutover Report

Date: 2026-06-21

Status: not cut over.

## Findings

- `POST /api/invoices/[id]/payment` uses Prisma for invoice lookup, payment creation, and invoice `amountPaid`/`balance` updates.
- `POST /api/bills/[id]/payment` uses Prisma for bill lookup, payment creation, and bill balance updates.
- No `PaymentRepository` interface or adapters currently exist.
- Supabase has a `payments` table with tenant RLS and `deleted_at`, but application write paths do not use it.

## Required Work

- Add payment repository interface plus Prisma/Supabase adapters.
- Move payment number generation into repository.
- Ensure invoice and bill balance updates happen atomically with payment creation.
- Add dual-write/parity behavior for payment writes and reads.

Blocker: payments must be migrated before global parity or Prisma removal readiness can pass.

