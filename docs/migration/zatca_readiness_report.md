# Phase D9 — ZATCA Readiness Audit

**Status:** Pre-audit checklist — **do not change ZATCA code yet.**

Run after invoice + credential repositories are wired through `provider.ts`.

## Verification checklist

| # | Check | Prisma path | Supabase path | Pass |
| - | ----- | ----------- | ------------- | ---- |
| 1 | Credentials decrypt from store | `credential-store.ts` → `prisma.zatcaCredential` | `zatca.repository.ts` → `zatca_credentials` | ☐ |
| 2 | Certificate loading for signing | `signature/certificate.ts` | Same code, different repo | ☐ |
| 3 | CSR PEM available (encrypted) | `credential-store.ts` | `csr_enc` column | ☐ |
| 4 | Secret / binary token decrypt | `credential-store.ts` | `secret_enc`, `binary_security_token_enc` | ☐ |
| 5 | Invoice lookup by ID | `invoice-service.ts` | `invoices` table | ☐ |
| 6 | Invoice hash field preserved | `invoice.zatcaInvoiceHash` | `zatca_invoice_hash` | ☐ |
| 7 | Previous hash chain | `hash/previous.ts` | `zatca_previous_invoice_hash` + ordering | ☐ |
| 8 | Audit log write/read | `audit/logger.ts` | `zatca_audit_logs` | ☐ |

## Pre-conditions

- [ ] Phase C validation passed (29/29) — **done**
- [ ] Invoice UUIDs preserved in `migration_id_map` — **done**
- [ ] `ZATCA_CREDENTIAL_ENCRYPTION_KEY` identical in `.env` for decrypt test
- [ ] `getCredential()` returns same decrypted bytes from both stores

## Test script (manual)

```bash
USE_SUPABASE=false DB_PARITY_CHECK=true npm run dev

# 1. GET /api/zatca/onboarding/status — compare settings + credential metadata
# 2. POST /api/zatca/onboarding/test-connection — sandbox ping
# 3. Pick migrated invoice ID from migration_id_map
#    GET /api/zatca/invoices/{id}/hash — compare hash output
```

## STOP conditions

- Decrypt failure on Supabase credential row
- Hash mismatch for same invoice ID
- Previous-hash chain break
- Missing audit log row count vs Prisma

## Rollback

ZATCA continues on Prisma until D10 explicitly switches `getZatcaRepository()` via provider.
