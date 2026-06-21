# Inventory Cutover Report

Date: 2026-06-21

Status: partial, not cut over.

## Findings

- `InventoryRepository` exists with Prisma and Supabase adapters for `findMany()` and `findById()`.
- `GET /api/inventory` and `GET /api/inventory/[id]` use repository reads.
- `POST /api/inventory`, `PUT /api/inventory/[id]`, and `DELETE /api/inventory/[id]` still use Prisma.

## Required Work

- Add create/update/delete to inventory repository.
- Route inventory writes through provider.
- Add inventory transactions and adjustments coverage; no complete repository coverage exists yet.

