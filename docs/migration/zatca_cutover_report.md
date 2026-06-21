# ZATCA Cutover Report

Date: 2026-06-21

Status: not started.

ZATCA cutover is intentionally blocked until invoice CRUD and payment cutover are stable under Supabase. No ZATCA migration was implemented in this pass because the prompt requires audit first and preservation of generated outputs exactly.

Blockers:

- ZATCA services still use Prisma for invoices, settings, credentials, onboarding requests, audit logs, and sandbox runs.
- Payment cutover is incomplete.
- Golden parity fixtures for XML, QR, hash, signed XML, clearance/reporting payloads are not yet present in this report set.

