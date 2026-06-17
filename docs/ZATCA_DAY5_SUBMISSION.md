# ZATCA Phase 2 — Day 5: Invoice Submission & Transmission

**Date:** June 2026  
**Scope:** XML signing, production CSID, clearance/reporting API integration, submission workflow, status tracking, invoice UI.  
**Out of scope:** Monitoring dashboards, audit dashboards, advanced retry systems, production hardening, full E2E test suite.

---

## Submission Workflow

```
Invoice
  → Validation
  → UBL XML
  → SHA-256 Hash
  → TLV QR validation
  → Sign XML (XAdES-style UBL extension)
  → Route by invoice type
      ├── STANDARD      → Clearance API
      └── SIMPLIFIED / CREDIT_NOTE / DEBIT_NOTE → Reporting API
  → Store response + update zatcaStatus
```

---

## Module Structure

```
src/lib/zatca/
├── signature/
│   ├── canonicalize.ts
│   ├── certificate.ts
│   ├── signer.ts
│   └── index.ts
├── api/
│   ├── client.ts
│   ├── reporting.ts
│   └── clearance.ts
├── submission/
│   ├── types.ts
│   ├── router.ts
│   ├── submit.ts
│   ├── status.ts
│   └── index.ts
└── onboarding/
    └── production-client.ts
```

---

## Schema Changes

### Invoice (ZATCA lifecycle)

| Field | Type | Purpose |
|-------|------|---------|
| `zatcaStatus` | `ZatcaInvoiceStatus` | Submission lifecycle |
| `zatcaResponseCode` | `String?` | API response code |
| `zatcaResponseMessage` | `String?` | API message |
| `zatcaRequestId` | `String?` | ZATCA request ID |
| `zatcaResponsePayload` | `String?` | Full JSON response |
| `clearedInvoicePayload` | `String?` | Cleared invoice from clearance API |
| `signedXml` | `String?` | Signed XML sent to ZATCA |

### ZatcaCredential

| Field | Purpose |
|-------|---------|
| `productionCertificate` | Production CSID certificate PEM |

### ZatcaInvoiceStatus enum

| Status | Meaning |
|--------|---------|
| `DRAFT` | Not submitted to ZATCA |
| `PENDING` | Submission in progress |
| `SUBMITTED` | Accepted, awaiting final status |
| `CLEARED` | Standard invoice cleared |
| `REPORTED` | Simplified/credit/debit reported |
| `REJECTED` | Rejected by ZATCA |
| `FAILED` | Submission error |

Migration: `prisma/migrations/20250610180000_zatca_phase2_day5/migration.sql`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/zatca/invoices/:id/submit` | Full submission workflow |
| `GET` | `/api/zatca/invoices/:id/status` | Current ZATCA status |
| `GET` | `/api/zatca/invoices/:id/response` | Submission response metadata |
| `POST` | `/api/zatca/onboarding/production` | Request production CSID |

Responses never expose secrets, private keys, or encrypted credentials.

---

## Routing Rules

| Invoice Type | API |
|--------------|-----|
| `STANDARD` | Clearance (`/invoices/clearance/single`) |
| `SIMPLIFIED` | Reporting (`/invoices/reporting/single`) |
| `CREDIT_NOTE` | Reporting |
| `DEBIT_NOTE` | Reporting |

---

## Example Reporting Response

```json
{
  "validationResults": {
    "status": "PASS",
    "infoMessages": [{ "code": "202", "message": "Invoice reported successfully" }]
  },
  "reportingStatus": "REPORTED",
  "requestID": "3e0f8b2a-7c1d-4f9a-b2e6-8d4c1a9f0e2b"
}
```

## Example Clearance Response

```json
{
  "validationResults": {
    "status": "PASS",
    "infoMessages": [{ "code": "202", "message": "Invoice cleared successfully" }]
  },
  "clearanceStatus": "CLEARED",
  "clearedInvoice": "PD94bWwgdmVyc2lvbj0iMS4wIi4uLg==",
  "requestID": "9a1c4d7e-2b3f-4a8c-9e6d-1f0a2b3c4d5e"
}
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Encrypt stored keys/secrets |
| `ZATCA_API_BASE_URL` | ZATCA gateway base URL |
| `ZATCA_MOCK_SUBMISSION` | Mock clearance/reporting APIs locally |
| `ZATCA_MOCK_ONBOARDING` | Mock onboarding + submission |

---

## UI Changes

### Invoices (`/invoices`)

- **View** button per invoice opens ZATCA status panel
- Shows: ZATCA status, last submission, request ID, clearance/reporting result
- **Submit to ZATCA** button when enabled, credentials exist, and not already submitted

### Settings (`/settings`)

- **Request Production CSID** button after compliance CSID is issued

---

## Related Docs

- [ZATCA_DAY4_ONBOARDING.md](./ZATCA_DAY4_ONBOARDING.md)
- [ZATCA_DAY3_HASH_QR.md](./ZATCA_DAY3_HASH_QR.md)
- [ZATCA_DAY2_XML.md](./ZATCA_DAY2_XML.md)
