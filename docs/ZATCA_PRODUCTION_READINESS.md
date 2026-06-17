# ZATCA Production Readiness Checklist

**Project:** hisab.ai  
**Last reviewed:** 2026-06-10 (Day 6)

Use this checklist before enabling production ZATCA submissions.

## Core Pipeline

| Capability | Status | Notes |
|------------|--------|-------|
| UBL 2.1 XML generation | ✅ Ready | `src/lib/zatca/xml/`, `GET /api/zatca/invoices/[id]/xml` |
| SHA-256 invoice hashing | ✅ Ready | `src/lib/zatca/hash/`, chained `previousInvoiceHash` |
| TLV QR generation | ✅ Ready | `src/lib/zatca/qr/`, `GET /api/zatca/invoices/[id]/qr` |
| XML signing (ECDSA) | ✅ Ready | `src/lib/zatca/signature/`; mock bypass when `ZATCA_MOCK_SUBMISSION=true` |
| Credential storage (encrypted) | ✅ Ready | `ZatcaCredential` model, AES-256-GCM |
| Reporting API | ✅ Ready | Simplified, credit, debit notes |
| Clearance API | ✅ Ready | Standard invoices |
| Invoice status tracking | ✅ Ready | `ZatcaInvoiceStatus` enum on `Invoice` |
| Audit logging | ✅ Ready | `ZatcaAuditLog` model + `logZatcaAudit()` |
| Monitoring dashboard | ✅ Ready | `/zatca` page + `GET /api/zatca/dashboard` |

## Onboarding

| Step | Status | Verification |
|------|--------|--------------|
| CSR generation (secp256k1) | ✅ | Settings → Connect to ZATCA → Generate CSR |
| Compliance CSID (OTP) | ✅ | `POST /api/zatca/onboarding/compliance` |
| Production CSID | ✅ | `POST /api/zatca/onboarding/production` |
| Environment selection | ✅ | `CompanySettings.zatcaEnvironment` SANDBOX / PRODUCTION |

## Validation Hardening (Day 6)

| Stage | Validated Fields |
|-------|------------------|
| Company | VAT TRN (15 digits), CRN, address, postal code |
| Customer | VAT TRN (standard invoices), address |
| Invoice | UUID, totals, VAT, currency (SAR), issue date/time |
| XML | Required UBL fields, invoice type mappings |
| Submission | Credentials present, ZATCA enabled, environment selected |

Validation errors return structured messages via `ZatcaError` and `validateFullSubmissionPipeline()`.

## Failure Handling

| Failure Type | Status Code Field | Invoice Status |
|--------------|-------------------|----------------|
| Missing credentials | `MISSING_CREDENTIALS` | FAILED |
| Expired credentials | `EXPIRED_CREDENTIALS` | FAILED |
| Invalid XML | `INVALID_XML` | FAILED |
| Invalid signature | `INVALID_SIGNATURE` | FAILED |
| Validation errors | `VALIDATION_FAILED` | FAILED |
| ZATCA API errors | `ZATCA_API_FAILURE` | FAILED |
| Timeouts | `ZATCA_TIMEOUT` | FAILED |

Failure details stored in `zatcaResponseMessage`, `zatcaFailureCode`, and `zatcaResponsePayload`.

## Sandbox E2E Tests

| Scenario | Route | Expected Status | Last Run |
|----------|-------|-----------------|----------|
| Standard Invoice | Clearance | CLEARED | PASS (2026-06-10) |
| Simplified Invoice | Reporting | REPORTED | PASS (2026-06-10) |
| Credit Note | Reporting | REPORTED | PASS (2026-06-10) |
| Debit Note | Reporting | REPORTED | PASS (2026-06-10) |

See [ZATCA_SANDBOX_TEST_RESULTS.md](./ZATCA_SANDBOX_TEST_RESULTS.md).

## Environment Variables (Production)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL recommended for production |
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | **Yes** | Encrypts private keys and secrets at rest |
| `ZATCA_API_BASE_URL` | Optional | Defaults to `https://gw-fatoora.zatca.gov.sa` |
| `ZATCA_MOCK_ONBOARDING` | No | Must be **unset** or `false` in production |
| `ZATCA_MOCK_SUBMISSION` | No | Must be **unset** or `false` in production |

## Pre-Launch Actions

- [ ] Set `ZATCA_CREDENTIAL_ENCRYPTION_KEY` to a strong random 32+ byte secret
- [ ] Complete production OTP onboarding and verify production CSID issued
- [ ] Confirm company VAT, CRN, and address in Settings match ZATCA registration
- [ ] Run sandbox E2E tests with mock disabled against ZATCA simulation environment
- [ ] Submit a pilot standard invoice and verify CLEARED status
- [ ] Submit a pilot simplified invoice and verify REPORTED status
- [ ] Review audit log on `/zatca` after pilot submissions
- [ ] Configure database backups including `ZatcaCredential` and `ZatcaAuditLog`
- [ ] Document on-call procedure for FAILED invoices (retry, support contact)

## Known Gaps Before Go-Live

1. **Live API integration** — Mock mode is default for local dev; production requires real Fatoora credentials and network egress.
2. **Certificate expiry monitoring** — No automated alert when CSID/certificate nears expiry; monitor via onboarding status.
3. **Retry queue** — Failed submissions are marked FAILED; manual resubmit from invoice view.
4. **secp256k1 + node-forge** — CSR generation may require Node/OpenSSL support; mock signing is not used when mock flags are off.

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering | | | |
| Finance / Compliance | | | |
| Operations | | | |
