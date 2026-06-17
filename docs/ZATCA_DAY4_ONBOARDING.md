# ZATCA Phase 2 — Day 4: Onboarding & Credential Storage

**Date:** June 2026  
**Scope:** CSR generation, OTP-based compliance CSID onboarding, encrypted credential storage, settings UI.  
**Out of scope:** Reporting API, clearance API, invoice submission, production transmission (Day 5).

---

## Overview

Day 4 adds ZATCA Fatoora onboarding infrastructure:

```
Settings → Generate CSR → OTP → Compliance CSID API → Store credentials
```

Credentials are encrypted at rest. Private keys and secrets are never returned by API responses.

---

## Module Structure

```
src/lib/zatca/onboarding/
├── types.ts              # Onboarding TypeScript interfaces
├── generate-csr.ts       # ECDSA secp256k1 CSR generation
├── credential-store.ts   # Encrypted persistence + status views
├── compliance-client.ts  # OTP-based compliance CSID request
├── service.ts            # Orchestration (generateAndStoreCsr, submitComplianceOnboarding)
└── index.ts
```

---

## Database Schema

### `ZatcaCredential`

| Field | Type | Notes |
|-------|------|-------|
| `environment` | `ZatcaEnvironment` | Unique per SANDBOX / PRODUCTION |
| `csr` | `String?` | PEM certificate signing request |
| `privateKeyEnc` | `String?` | AES-256-GCM encrypted PEM private key |
| `certificate` | `String?` | Compliance CSID certificate (PEM) |
| `secretEnc` | `String?` | Encrypted ZATCA API secret |
| `complianceCsid` | `String?` | Compliance CSID request/token identifier |
| `productionCsid` | `String?` | Reserved for production CSID (Day 5+) |
| `onboardingStatus` | `ZatcaOnboardingStatus` | Workflow state |
| `lastError` | `String?` | Last onboarding failure message |
| `onboardedAt` | `DateTime?` | Compliance CSID issued timestamp |

### `ZatcaOnboardingStatus` enum

| Value | Meaning |
|-------|---------|
| `NOT_STARTED` | No CSR generated |
| `CSR_GENERATED` | CSR and private key stored |
| `COMPLIANCE_ISSUED` | Compliance CSID received from ZATCA |
| `PRODUCTION_ISSUED` | Production CSID stored (future) |
| `FAILED` | Last onboarding step failed |

Migration: `prisma/migrations/20250610160000_zatca_phase2_day4/migration.sql`

Apply with:

```bash
npx prisma migrate deploy
npx prisma generate
```

---

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `node-forge` | CSR assembly and PEM encoding |
| `@types/node-forge` | TypeScript types |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Production | AES key source for encrypting private keys and secrets |
| `ZATCA_API_BASE_URL` | Optional | Default: `https://gw-fatoora.zatca.gov.sa` |
| `ZATCA_MOCK_ONBOARDING` | Optional | Set `true` for local dev without live ZATCA API |

---

## CSR Generation

- Curve: **ECDSA secp256k1**
- Hash: **SHA-256**
- CN: `TST-{VAT}` (sandbox) or `{VAT}` (production)
- SAN extension includes: serial number, VAT UID, invoice types (`1100`), address, business category

```typescript
import { generateZatcaCsr } from '@/lib/zatca/onboarding'

const csr = generateZatcaCsr({
  environment: 'SANDBOX',
  vatNumber: '300000000000003',
  organizationName: 'NETKOM COMPANY FOR COMMUNICATION LLC',
  organizationUnit: 'Riyadh Branch',
  registeredAddress: 'Riyadh',
})
```

---

## Compliance CSID Flow (OTP)

1. User obtains OTP from ZATCA Fatoora simulation portal
2. App generates CSR via `POST /api/zatca/onboarding/csr`
3. App submits CSR + OTP via `POST /api/zatca/onboarding/compliance`
4. ZATCA returns `binarySecurityToken` (certificate) and `secret`
5. Credentials encrypted and stored; status → `COMPLIANCE_ISSUED`

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/zatca/onboarding/csr` | Generate and store CSR |
| `POST` | `/api/zatca/onboarding/compliance` | Body: `{ "otp": "123456" }` |
| `GET` | `/api/zatca/onboarding/status` | Onboarding status (no secrets) |

All require authentication.

### Status response example

```json
{
  "zatcaEnabled": true,
  "environment": "SANDBOX",
  "onboardingStatus": "COMPLIANCE_ISSUED",
  "hasCsr": true,
  "hasCertificate": true,
  "hasComplianceCsid": true,
  "hasProductionCsid": false,
  "onboardedAt": "2026-06-10T12:00:00.000Z",
  "lastError": null,
  "updatedAt": "2026-06-10T12:00:00.000Z"
}
```

---

## Settings UI

The Settings page (`/settings`) now includes:

- **Enable Saudi E-Invoicing** toggle
- **ZATCA Environment** selector (Sandbox / Production)
- **Onboarding status** badges (CSR, Certificate, Compliance CSID)
- **OTP input** and **Connect to ZATCA** button

### Connect flow

1. Enable Saudi E-Invoicing and save VAT TRN
2. Click **Connect to ZATCA** → CSR generated
3. Enter OTP from Fatoora portal
4. Click **Connect to ZATCA** again → compliance CSID stored

---

## Security

- Private keys and secrets stored as **AES-256-GCM** ciphertext
- Encryption key from `ZATCA_CREDENTIAL_ENCRYPTION_KEY` (required in production)
- API responses never include private keys, secrets, or decrypted credentials
- Dev fallback key used only when encryption env var is unset in non-production

---

## Local Development (Mock Mode)

```env
ZATCA_MOCK_ONBOARDING=true
ZATCA_CREDENTIAL_ENCRYPTION_KEY=your-dev-secret-key-min-32-chars
```

Mock mode returns simulated compliance CSID without calling ZATCA servers.

---

## Next Steps (Day 5, not implemented)

- Production CSID request after compliance testing
- Invoice clearance API (standard invoices)
- Invoice reporting API (simplified invoices)
- Signed XML submission and delivery workflows

---

## Related Docs

- [ZATCA_DAY2_XML.md](./ZATCA_DAY2_XML.md)
- [ZATCA_DAY3_HASH_QR.md](./ZATCA_DAY3_HASH_QR.md)
- [ZATCA_GAP_ANALYSIS.md](./ZATCA_GAP_ANALYSIS.md)
