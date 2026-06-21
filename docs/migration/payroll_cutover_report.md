# Payroll Cutover Report

Date: 2026-06-21

Status: partial, not cut over.

## Findings

- `PayrollRepository` exists with Prisma and Supabase adapters for reads.
- Payroll creation, payroll update, approval, and employee CRUD still use Prisma route code.
- Payroll lines are still nested Prisma writes in route/service logic.

## Required Work

- Add employee repository or expand payroll repository to include employees.
- Add create/update/approve methods for payroll entries and lines.
- Route payroll writes through provider.

