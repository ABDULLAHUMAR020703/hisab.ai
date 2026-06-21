# Auth Cutover Report

Date: 2026-06-21

Status: audit complete, no auth code changes.

## Findings

- Current auth uses a custom `session` cookie.
- `src/lib/auth.ts` reads `prisma.appSession.findUnique()`.
- Login creates `AppSession` rows in SQLite/Prisma.
- Logout deletes `AppSession` rows in SQLite/Prisma.
- Most API routes call `requireAuth()`.
- Supabase Auth profiles and company users exist, and profiles preserve `legacy_user_id`.

## Decision

Retain existing auth until all data modules are cut over, then migrate auth deliberately to Supabase Auth. Immediate auth migration would expand blast radius while accounting, payment, payroll, inventory, reports, and ZATCA are still mixed.

## Blockers

- `AppSession` is a hard Prisma dependency.
- User routes are Prisma-backed.
- Permission model needs a route-by-route check against `company_users`.

