# Accounting Cutover Report

Date: 2026-06-21

Status: not cut over.

## Findings

- Account reads have repository coverage, but account writes still use Prisma in route handlers.
- Journal entries, journal lines, receipts, tax rates, and cost centers are still direct Prisma route implementations.
- Report routes for balance sheet, cash flow, general ledger, and profit/loss still query Prisma.

## Required Work

- Expand accounting repositories to cover account writes, cost centers, tax rates, journal entries, journal lines, receipts, and reports.
- Preserve journal balancing validation before writes.
- Move posting logic and sequence generation into repositories/services that use provider resolution.

Blocker: accounting remains a major Prisma dependency.

