# ZATCA Audit Report

Date: 2026-06-21

Status: audit only. No ZATCA code changes were made.

## Direct Prisma Areas

- Invoice loading and updates: `src/lib/zatca/invoice-service.ts`, `src/lib/zatca/submission/submit.ts`, `src/lib/zatca/submission/status.ts`
- Hash chain and counters: `src/lib/zatca/hash/previous.ts`, `src/lib/zatca/hash/counter.ts`
- Credentials and settings: `src/lib/zatca/onboarding/credential-store.ts`, `src/lib/zatca/onboarding/onboard.ts`, `src/lib/zatca/onboarding/service.ts`
- Compliance sample invoices: `src/lib/zatca/onboarding/compliance-checks.ts`
- Sandbox runs: `src/lib/zatca/testing/sandbox-runner.ts`
- Monitoring: `src/lib/zatca/monitoring/dashboard.ts`
- Audit logging: `src/lib/zatca/audit/logger.ts`
- ZATCA routes with direct Prisma: compliance, compliance-check, signed-xml, onboarding status, onboarding test-connection.

## Protected Fields

Any future ZATCA cutover must preserve:

- Invoice UUIDs
- invoice hashes
- previous invoice hashes
- signed XML
- cleared invoice payloads
- CSIDs
- certificates and encrypted private key/CSR fields
- hash chain ordering by `created_at`

## Recommendation

Do not migrate ZATCA services until invoice CRUD and payment cutover have runtime parity. Use golden invoice XML/hash/signature fixtures before changing ZATCA data access.

