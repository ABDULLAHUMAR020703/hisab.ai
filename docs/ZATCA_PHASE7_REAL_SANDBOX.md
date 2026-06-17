# ZATCA Phase 7 — Real Sandbox Verification

**Project:** hisab.ai  
**Date:** 2026-06-10  
**Gateway:** `https://gw-fatoora.zatca.gov.sa`  
**Connectivity:** Verified (HTTP 400 on unauthenticated compliance POST — gateway reachable)

---

## Prerequisites

1. **Disable mock mode** in `.env`:

```env
# Remove or set to false:
ZATCA_MOCK_ONBOARDING=false
ZATCA_MOCK_SUBMISSION=false

ZATCA_CREDENTIAL_ENCRYPTION_KEY=<strong-random-secret>
ZATCA_API_BASE_URL=https://gw-fatoora.zatca.gov.sa
DATABASE_URL="file:./dev.db"
```

2. **Fatoora Simulation Portal:** https://fatoora.zatca.gov.sa/ (toggle Simulation mode)
3. **Company settings** populated with real sandbox VAT TRN, CRN, and Saudi National Address (no `0000` placeholders)
4. **OTP** generated from Fatoora portal for your EGS unit

---

## Task 1 — Real Sandbox Onboarding

### Procedure

| Step | Action | Endpoint |
|------|--------|----------|
| 1 | Enable ZATCA, set environment to SANDBOX in Settings | UI |
| 2 | Generate CSR | `POST /api/zatca/onboarding/csr` |
| 3 | Submit OTP from Fatoora portal | `POST /api/zatca/onboarding/compliance` `{ "otp": "123456" }` |
| 4 | Verify status | `GET /api/zatca/onboarding/status` |

### Expected Results

| Check | Expected |
|-------|----------|
| CSR generation | `onboardingStatus: CSR_GENERATED`, CSR stored |
| OTP compliance | `dispositionMessage: ISSUED` |
| Compliance CSID | `complianceCsid` + `certificate` stored |
| Secret | Encrypted in `ZatcaCredential.secretEnc` |
| Audit log | `CSR_GENERATED`, `COMPLIANCE_CSID_ISSUED` |

### Verification Record

| Field | Result |
|-------|--------|
| CSR accepted by ZATCA | _Pending live OTP run_ |
| OTP flow | _Pending live OTP run_ |
| Compliance CSID issued | _Pending live OTP run_ |
| Certificate PEM stored | _Pending live OTP run_ |
| Secret stored | _Pending live OTP run_ |
| Request ID | _Record from API response_ |

**Code fix applied:** Production CSID path now uses `/e-invoicing/simulation/production/csids` for SANDBOX (was incorrectly hardcoded to `/core/`).

**CSR note:** Simulation portal may require `PREZATCA-Code-Signing` template per ZATCA manual; verify CSR against portal if `Invalid-CSR` is returned.

---

## Task 2 — Production CSID Flow

### Procedure

Before requesting Production CSID, ZATCA requires **6 compliance invoice checks** (standard/simplified × sales/credit/debit):

```
POST /api/zatca/invoices/[id]/compliance-check
```

Repeat for each required invoice type using compliance CSID credentials.

| Step | Action | Endpoint |
|------|--------|----------|
| 1 | Submit 6 compliance invoices | `POST .../compliance-check` per invoice |
| 2 | Request Production CSID | `POST /api/zatca/onboarding/production` |
| 3 | Verify credentials | `GET /api/zatca/onboarding/status` |

### Expected Results

| Check | Expected |
|-------|----------|
| Production CSID | `onboardingStatus: PRODUCTION_ISSUED` |
| Production certificate | `productionCertificate` stored |
| Production secret | `secretEnc` updated |
| Audit log | `PRODUCTION_CSID_ISSUED` |

### Verification Record

| Field | Result |
|-------|--------|
| Production CSID request | _Pending after compliance invoices_ |
| `productionCertificate` stored | _Pending_ |
| `productionCsid` stored | _Pending_ |
| API response payload | _Capture from audit log / API_ |

---

## Task 3 — Real Invoice Submission Tests

### Procedure

With Production CSID issued and mock flags off:

| Type | Route | Expected Status | Endpoint |
|------|-------|-----------------|----------|
| Standard | Clearance | CLEARED | `POST /api/zatca/invoices/[id]/submit` |
| Simplified | Reporting | REPORTED | same |
| Credit Note | Reporting | REPORTED | same |
| Debit Note | Reporting | REPORTED | same |

### Capture per submission

- `zatcaRequestId`
- `zatcaResponseCode` / `zatcaResponseMessage`
- `GET /api/zatca/invoices/[id]/response` — full payload
- Validation warnings from `validationResults.warningMessages`

### Verification Record

| Scenario | Request ID | Status | Warnings | Errors |
|----------|------------|--------|----------|--------|
| Standard | _Pending_ | CLEARED | | |
| Simplified | _Pending_ | REPORTED | | |
| Credit Note | _Pending_ | REPORTED | | |
| Debit Note | _Pending_ | REPORTED | | |

---

## Task 4 — XML Compliance Verification

### Offline review (no OTP required)

```bash
GET /api/zatca/invoices/[id]/compliance
```

Checks: namespaces, ProfileID, UUID, ICV, PIH, QR (reporting types), UBL signature stub, placeholder addresses.

### Phase 7 XML fixes applied

| Element | Status |
|---------|--------|
| ICV (`AdditionalDocumentReference`) | ✅ Added |
| PIH (with first-invoice seed) | ✅ Added |
| QR (simplified/credit/debit) | ✅ Added |
| UBL `cac:Signature` stub | ✅ Added |
| ZATCA hash algorithm (strip QR/sig/extensions) | ✅ Updated |
| Credit/debit ProfileID | ✅ `reporting:1.0` |
| Credit/debit type name | ✅ `0200000` |

### Remaining XML gaps

See [ZATCA_COMPLIANCE_GAP_REPORT.md](./ZATCA_COMPLIANCE_GAP_REPORT.md) for Phase 2 QR tags 6–9, full XAdES SignedProperties, billing references for credit/debit.

---

## Task 5 — Signature Verification

| Check | Offline | Live sandbox |
|-------|---------|--------------|
| Signature block present | `GET .../signed-xml` | After submit |
| Digest matches canonical XML | `verifyInvoiceSignature()` | ZATCA validation |
| ECDSA accepted | N/A in mock | _Pending live run_ |
| Certificate chain | Issued by ZATCA on onboarding | _Pending live run_ |

**Code fix:** `verifyInvoiceSignature()` no longer returns `true` on ECDSA failure when mock is disabled.

---

## Task 6 — Failure Testing

### Automated (offline)

```bash
npx tsx -r ./scripts/setup-server-only.cjs scripts/zatca-phase7-verify.mjs
```

Or: `GET /api/zatca/verify/failure-scenarios`

| Scenario | Expected | Result |
|----------|----------|--------|
| Missing company VAT | VALIDATION_FAILED | ✅ PASS |
| Missing company address | VALIDATION_FAILED | ✅ PASS |
| Missing customer VAT (standard) | VALIDATION_FAILED | ✅ PASS |
| Invalid UUID | VALIDATION_FAILED | ✅ PASS |
| Invalid totals | VALIDATION_FAILED | ✅ PASS |
| Non-SAR currency | VALIDATION_FAILED | ✅ PASS |

Invalid credentials and ZATCA API failures are mapped to `ZatcaError` with `zatcaStatus: FAILED` and `zatcaFailureCode`.

---

## Scripts

```bash
# Offline Phase 7 verification (failure + mock E2E)
DATABASE_URL="file:./dev.db" npx tsx -r ./scripts/setup-server-only.cjs scripts/zatca-phase7-verify.mjs

# Real sandbox (mock off, requires OTP)
DATABASE_URL="file:./dev.db" ZATCA_MOCK_ONBOARDING=false ZATCA_MOCK_SUBMISSION=false \
  npx tsx -r ./scripts/setup-server-only.cjs scripts/zatca-phase7-verify.mjs
```

---

## Related

- [ZATCA_COMPLIANCE_GAP_REPORT.md](./ZATCA_COMPLIANCE_GAP_REPORT.md)
- [ZATCA_RELEASE_CHECKLIST.md](./ZATCA_RELEASE_CHECKLIST.md)
- [ZATCA_PRODUCTION_READINESS.md](./ZATCA_PRODUCTION_READINESS.md)
