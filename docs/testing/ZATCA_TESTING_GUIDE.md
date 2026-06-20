# ZATCA Testing Guide — hisab.ai

**Scope:** ZATCA Phase 2 e-invoicing compliance testing  
**Modes:** Mock (local) vs Live (Fatoora sandbox OTP)

---

## Prerequisites

### Local mock testing

```env
ZATCA_MOCK_ONBOARDING=true
ZATCA_MOCK_SUBMISSION=true
DATABASE_URL=file:./prisma/dev.db
```

```powershell
npm run db:seed
npm run qa:seed
npm run dev
```

### Live sandbox testing

```env
ZATCA_MOCK_ONBOARDING=false
ZATCA_MOCK_SUBMISSION=false
ZATCA_CREDENTIAL_ENCRYPTION_KEY=<32+ char secret>
ZATCA_API_BASE_URL=https://gw-fatoora.zatca.gov.sa
```

Requires: OTP from Fatoora simulation portal, valid sandbox VAT TRN in Settings.

---

## Part 1 — Onboarding Tests

### ONB-001 — CSR Generation

| Step | Action |
|------|--------|
| 1 | Settings → Enable ZATCA → SANDBOX |
| 2 | Click **Generate CSR** |
| 3 | Check onboarding status API |

**API:** `POST /api/zatca/onboarding/csr`

**Expected (mock):**
- `onboardingStatus`: `CSR_GENERATED`
- `ZatcaAuditLog`: action `CSR_GENERATED`, result `SUCCESS`
- `privateKeyEnc` populated (encrypted)

**Expected (live):**
- Real secp256k1 keypair
- CSR PEM stored

**Failure cases:**
- Missing VAT TRN in settings
- Missing company legal name

---

### ONB-002 — Compliance CSID

| Step | Action |
|------|--------|
| 1 | Obtain OTP from Fatoora portal (live) or use `123456` (mock) |
| 2 | Settings → Enter OTP → Request Compliance CSID |

**API:** `POST /api/zatca/onboarding/compliance`  
**Body:** `{ "otp": "123456" }`

**Expected:**
- `onboardingStatus`: `COMPLIANCE_ISSUED`
- `certificate` and `secretEnc` stored
- Audit: `COMPLIANCE_CSID_ISSUED`

**Failure cases:**
| Case | Expected |
|------|----------|
| Invalid OTP | Error message from ZATCA |
| CSR not generated | Error before API call |
| Network down | FAILED status + lastError |

---

### ONB-003 — Production CSID

**Prerequisite:** Compliance CSID issued + 6 compliance invoices passed (ZATCA requirement).

| Step | Action |
|------|--------|
| 1 | Complete compliance invoice checks (see Part 3) |
| 2 | Settings → Request Production CSID |

**API:** `POST /api/zatca/onboarding/production`

**Expected:**
- `onboardingStatus`: `PRODUCTION_ISSUED`
- `productionCertificate` stored
- Audit: `PRODUCTION_CSID_ISSUED`

**Sandbox path:** `/e-invoicing/simulation/production/csids`

---

### ONB-004 — Onboarding status

**API:** `GET /api/zatca/onboarding/status`

**Expected:** Returns flags only — no private key, no secret plaintext.

---

## Part 2 — Invoice Type Tests

Create test invoices before submission. Use QA seed or create manually.

### INV-ZAT-001 — Standard Invoice (B2B)

| Field | Value |
|-------|-------|
| Type | `STANDARD` |
| Customer | Business with VAT TRN |
| Route | Clearance API |
| Expected status | `CLEARED` (mock/live) |
| Profile ID | `clearance:1.0` |
| QR in XML | Optional (ZATCA may add on clearance) |

**Steps:**
1. Create STANDARD invoice with valid Saudi addresses
2. `GET .../compliance` — offline check PASS
3. `POST .../submit`
4. Verify `zatcaStatus = CLEARED`

---

### INV-ZAT-002 — Simplified Invoice (B2C)

| Field | Value |
|-------|-------|
| Type | `SIMPLIFIED` |
| Route | Reporting API |
| Expected status | `REPORTED` |
| Profile ID | `reporting:1.0` |
| QR | Required in XML (tags 1–9) |

---

### INV-ZAT-003 — Credit Note

| Field | Value |
|-------|-------|
| Type | `CREDIT_NOTE` |
| Invoice type code | `381` |
| Route | Reporting |
| QR Tag 9 | Required (CA signature) |

---

### INV-ZAT-004 — Debit Note

| Field | Value |
|-------|-------|
| Type | `DEBIT_NOTE` |
| Invoice type code | `383` |
| Route | Reporting |

---

## Part 3 — Compliance Pipeline Tests

### CMP-001 — XML Generation

**API:** `GET /api/zatca/invoices/{id}/xml?format=json`

**Verify:**
- [ ] Root namespace `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`
- [ ] `cbc:ProfileID` matches invoice type
- [ ] `cbc:UUID` present
- [ ] ICV `AdditionalDocumentReference`
- [ ] PIH `AdditionalDocumentReference`
- [ ] `cac:Signature` stub
- [ ] Supplier VAT `schemeID="VAT"`
- [ ] `validation.valid === true`

---

### CMP-002 — Hash Generation

**API:** `GET /api/zatca/invoices/{id}/hash`

**Verify:**
- [ ] 64-char lowercase hex returned
- [ ] Persisted to `invoice.invoiceHash`
- [ ] Re-run returns same hash (deterministic)
- [ ] Hash excludes UBLExtensions, QR, Signature blocks

---

### CMP-003 — QR Generation

**API:** `GET /api/zatca/invoices/{id}/qr`

**Phase 1 (pre-sign):** Tags 1–5 in TLV  
**Phase 2 (post-sign workflow):** Tags 6–9 after submit

| Tag | Content | Source |
|-----|---------|--------|
| 1 | Seller name | Company settings |
| 2 | VAT TRN | Company settings |
| 3 | Timestamp | Issue date + time |
| 4 | Invoice total | Invoice total |
| 5 | VAT total | taxAmount |
| 6 | Invoice hash | SignedInfo DigestValue |
| 7 | ECDSA signature | SignatureValue |
| 8 | Public key | Certificate |
| 9 | CA signature | Cert signature (simplified only) |

**Decode:** https://emvlab.org/tlvutils/

---

### CMP-004 — Signature Validation

**After submit:**

1. `GET .../signed-xml` — XML contains `ds:Signature`
2. Verify locally: `verifyInvoiceSignature()` in signer module
3. SignedProperties contains SigningTime + SigningCertificate

**Mock mode:** Signature is digest-based placeholder — **not valid for live ZATCA**.

---

### CMP-005 — Compliance invoice check (pre-production)

**API:** `POST /api/zatca/invoices/{id}/compliance-check`

**Expected (mock):** `validationStatus: PASS`  
**Expected (live):** ZATCA validates signed XML

Run for **6 invoice types** required by ZATCA before Production CSID.

---

### CMP-006 — Submission

**API:** `POST /api/zatca/invoices/{id}/submit`

**Flow:**
1. Validate readiness
2. Generate XML + hash
3. Sign + embed Phase 2 QR
4. Route: clearance vs reporting
5. Persist status + signedXml
6. Audit log

---

### CMP-007 — Status tracking

**API:** `GET /api/zatca/invoices/{id}/status`

**States:** DRAFT → PENDING → SUBMITTED → CLEARED/REPORTED/FAILED

Terminal states cannot re-submit.

---

## Part 4 — Automated E2E (Mock)

### Run all scenarios

```powershell
npm run zatca:sandbox
```

Or UI: ZATCA Monitor → **Run Sandbox Tests**

Or API: `POST /api/zatca/sandbox/run`

| Scenario | Expected status |
|----------|-----------------|
| STANDARD | CLEARED |
| SIMPLIFIED | REPORTED |
| CREDIT_NOTE | REPORTED |
| DEBIT_NOTE | REPORTED |

### Phase 7 verification

```powershell
npm run zatca:verify
```

---

## Part 5 — Failure Tests

### Automated failure scenarios

**API:** `GET /api/zatca/verify/failure-scenarios`

| Scenario | What it tests |
|----------|---------------|
| Missing seller name | Validation hardening |
| Invalid VAT format | TRN validation |
| Negative amounts | Business rules |
| Empty lines | Invoice structure |
| Placeholder address | XML compliance warning |
| Invalid profile | Document validation |

### Manual failure tests

| Test | Setup | Expected |
|------|-------|----------|
| Missing VAT | Clear company taxId → submit | VALIDATION_FAILED |
| Missing address | Placeholder `0000` | XML warning / reject |
| Invalid UUID | Clear invoiceUUID | Warning or generated UUID |
| Missing credentials | Skip onboarding → submit | MISSING_CREDENTIALS |
| Expired credentials | Use revoked cert (live) | ZATCA API error |
| API failure | Disconnect network | FAILED + audit log |
| Timeout | Slow network | FAILED with diagnostic |
| Double submit | Submit twice | ALREADY_SUBMITTED |

---

## Part 6 — Monitoring & Audit

### ZATCA Monitor page (`/zatca`)

Verify after tests:
- [ ] Stats cards update (cleared, reported, failed counts)
- [ ] Recent activity shows submitted invoices
- [ ] Audit log entries with timestamps
- [ ] Sandbox test history with step details

### Audit log actions to verify

| Action | When |
|--------|------|
| CSR_GENERATED | After CSR |
| COMPLIANCE_CSID_ISSUED | After compliance |
| PRODUCTION_CSID_ISSUED | After production |
| INVOICE_SUBMITTED | Every submit |
| INVOICE_CLEARED | Standard success |
| INVOICE_REPORTED | Simplified success |
| SUBMISSION_FAILED | Any failure |
| SANDBOX_TEST_RUN | Sandbox button |

---

## Part 7 — Live Sandbox Checklist

Only after all mock tests pass:

- [ ] `ZATCA_MOCK_*` unset or `false`
- [ ] `ZATCA_CREDENTIAL_ENCRYPTION_KEY` set
- [ ] Company settings: real sandbox VAT, CRN, Saudi address (no placeholders)
- [ ] PostgreSQL in production (not SQLite)
- [ ] OTP obtained from Fatoora simulation portal
- [ ] CSR generated with portal-compatible template
- [ ] Compliance CSID issued
- [ ] 6 compliance invoices PASS via `/compliance-check`
- [ ] Production CSID issued
- [ ] 1 STANDARD invoice cleared
- [ ] 1 SIMPLIFIED invoice reported
- [ ] Validate QR with ZATCA SDK or portal validator

See: [ZATCA_TESTING_GUIDE.md](./ZATCA_TESTING_GUIDE.md) (real sandbox OTP section)

---

## Highest-Risk ZATCA Areas

1. **Live ECDSA signature** — mock signatures invalid in production
2. **SignedProperties hashing** — whitespace-sensitive
3. **Invoice hash canonicalization** — may differ from ZATCA SDK
4. **QR tags 6–9** — must match signed XML exactly
5. **PIH hash chain** — rejected invoices still affect chain
6. **Production CSID** — blocked until 6 compliance invoices pass
