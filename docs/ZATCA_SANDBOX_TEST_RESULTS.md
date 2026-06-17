# ZATCA Sandbox End-to-End Test Results

**Project:** hisab.ai  
**Date:** 2026-06-10  
**Environment:** SANDBOX (mock mode)  
**Runner:** `scripts/run-zatca-sandbox.mjs` / `POST /api/zatca/sandbox/run`

## Configuration

| Setting | Value |
|---------|-------|
| `ZATCA_MOCK_SUBMISSION` | `true` |
| `ZATCA_MOCK_ONBOARDING` | `true` |
| Database | SQLite `dev.db` |
| API base | `https://gw-fatoora.zatca.gov.sa` (mocked locally) |

## Summary

| Scenario | Result | Expected Status | Actual Status | Duration |
|----------|--------|-----------------|---------------|----------|
| Standard Invoice | **PASS** | CLEARED | CLEARED | 596ms |
| Simplified Invoice | **PASS** | REPORTED | REPORTED | 138ms |
| Credit Note | **PASS** | REPORTED | REPORTED | 134ms |
| Debit Note | **PASS** | REPORTED | REPORTED | 137ms |

**Overall: 4/4 passed**

Results are persisted in `ZatcaSandboxTestRun` and visible on the `/zatca` monitoring dashboard.

---

## Scenario 1 — Standard Invoice (Clearance)

**Flow:** Create → XML → Hash → QR → Sign → Clearance → Status = CLEARED

| Step | Result | Detail |
|------|--------|--------|
| Create invoice | ✓ | INV-0001 |
| Validate | ✓ | All stages passed |
| Generate XML | ✓ | 4067 bytes |
| Hash | ✓ | SHA-256 digest generated |
| QR | ✓ | TLV payload generated |
| Sign | ✓ | Signature block embedded |
| Clearance | ✓ | CLEARED |
| Status | ✓ | CLEARED (expected CLEARED) |

---

## Scenario 2 — Simplified Invoice (Reporting)

**Flow:** Create → XML → Hash → QR → Sign → Reporting → Status = REPORTED

| Step | Result | Detail |
|------|--------|--------|
| Create invoice | ✓ | INV-0002 |
| Validate | ✓ | All stages passed |
| Generate XML | ✓ | 4069 bytes |
| Hash | ✓ | SHA-256 digest generated |
| QR | ✓ | TLV payload generated |
| Sign | ✓ | Signature block embedded |
| Reporting | ✓ | REPORTED |
| Status | ✓ | REPORTED (expected REPORTED) |

---

## Scenario 3 — Credit Note (Reporting)

**Flow:** Create → XML → Hash → QR → Sign → Reporting → Status = REPORTED

| Step | Result | Detail |
|------|--------|--------|
| Create invoice | ✓ | INV-0003 |
| Validate | ✓ | All stages passed |
| Generate XML | ✓ | 4070 bytes |
| Hash | ✓ | SHA-256 digest generated |
| QR | ✓ | TLV payload generated |
| Sign | ✓ | Signature block embedded |
| Reporting | ✓ | REPORTED |
| Status | ✓ | REPORTED (expected REPORTED) |

---

## Scenario 4 — Debit Note (Reporting)

**Flow:** Create → XML → Hash → QR → Sign → Reporting → Status = REPORTED

| Step | Result | Detail |
|------|--------|--------|
| Create invoice | ✓ | INV-0004 |
| Validate | ✓ | All stages passed |
| Generate XML | ✓ | 4069 bytes |
| Hash | ✓ | SHA-256 digest generated |
| QR | ✓ | TLV payload generated |
| Sign | ✓ | Signature block embedded |
| Reporting | ✓ | REPORTED |
| Status | ✓ | REPORTED (expected REPORTED) |

---

## How to Re-run

### CLI (requires `DATABASE_URL` pointing at your app database)

```bash
DATABASE_URL="file:./dev.db" ZATCA_MOCK_SUBMISSION=true ZATCA_MOCK_ONBOARDING=true \
  npx tsx -r ./scripts/setup-server-only.cjs scripts/run-zatca-sandbox.mjs
```

### UI

1. Sign in to hisab.ai
2. Open **ZATCA Monitor** (`/zatca`)
3. Click **Run Sandbox Tests**

### API

```http
POST /api/zatca/sandbox/run
```

Requires authenticated session.

---

## Notes

- Mock mode exercises the full pipeline (validation, XML, hash, QR, signing, routing, status updates) without calling live ZATCA APIs.
- Mock signing uses a digest-based placeholder signature when `ZATCA_MOCK_SUBMISSION=true`; production submissions use ECDSA secp256k1.
- Live sandbox testing against ZATCA requires valid OTP onboarding, `ZATCA_MOCK_SUBMISSION=false`, and network access to the Fatoora gateway.
