# Global Parity Report

Date: 2026-06-21

Status: blocked.

`npx tsc --noEmit` passed, but global runtime parity is not valid yet because multiple write modules still bypass repositories and write only to Prisma.

## Blocking Modules

- Payments
- Bills
- Accounting writes and reports
- Inventory writes
- Payroll and employees
- Users/auth
- Invoice payment/PDF
- ZATCA services
- Seed/QA/demo utilities

Global parity should be rerun only after the remaining write paths are moved behind repositories or intentionally excluded from runtime production paths.

