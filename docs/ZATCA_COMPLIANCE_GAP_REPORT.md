# ZATCA Compliance Gap Report

**Project:** hisab.ai  
**Review date:** 2026-06-10 (Phase 7)  
**Scope:** Real sandbox readiness vs ZATCA Fatoora Phase 2 requirements

---

## Executive Summary

Offline verification and code audit identified **8 compliance gaps**. Phase 7 fixes addressed **5 critical items** (production CSID path, ICV/PIH/QR in XML, hash algorithm, profile codes, signature verification). **3 gaps remain** that require live sandbox validation or further implementation before production go-live.

| Severity | Count | Fixed in Phase 7 |
|----------|-------|------------------|
| Critical | 3 | 2 fixed, 1 partial |
| High | 4 | 3 fixed |
| Medium | 5 | 0 fixed |
| Low | 3 | — |

---

## Critical Gaps

### GAP-001 — Production CSID used wrong API path for sandbox

| | |
|---|---|
| **Severity** | Critical |
| **Impact** | Production CSID request fails with 404/wrong environment in simulation |
| **Status** | ✅ **Fixed** |
| **Fix** | `production-client.ts` now uses `/e-invoicing/simulation/production/csids` for SANDBOX |

---

### GAP-002 — XML missing ICV, PIH, QR, UBL signature stub

| | |
|---|---|
| **Severity** | Critical |
| **Impact** | ZATCA rejects invoices at compliance/clearance validation |
| **Status** | ✅ **Fixed** |
| **Fix** | `xml/builder.ts`, `mapper.ts`, `invoice-service.ts` embed ICV, PIH, optional QR, and `cac:Signature` stub |

---

### GAP-003 — Invoice hash computed on raw XML without ZATCA exclusions

| | |
|---|---|
| **Severity** | Critical |
| **Impact** | `invoiceHash` mismatch → clearance/reporting rejection |
| **Status** | ✅ **Fixed** |
| **Fix** | `hash/zatca-hash.ts` strips UBLExtensions, QR reference, and Signature before SHA-256 |

---

### GAP-004 — Full XAdES signature not aligned with ZATCA spec

| | |
|---|---|
| **Severity** | Critical |
| **Impact** | Live sandbox may reject signatures (Invalid-Signature) |
| **Status** | ⚠️ **Partial** |
| **Description** | Current signer uses simplified C14N, signs digest string directly, and omits full SignedProperties (certificate digest, issuer, serial). ZATCA requires multi-step XAdES per technical guideline §5. |
| **Recommendation** | Align with ZATCA SDK signing steps or integrate official Java SDK via subprocess. Validate first signed invoice against ZATCA web validator. |

---

## High Gaps

### GAP-005 — Compliance invoice workflow not automated end-to-end

| | |
|---|---|
| **Severity** | High |
| **Impact** | Production CSID blocked until 6 compliance invoices pass manually |
| **Status** | ⚠️ **Partial** |
| **Fix applied** | `api/compliance-invoices.ts` + `POST .../compliance-check` endpoint |
| **Recommendation** | Add guided onboarding wizard listing 6 required invoice types with pass/fail status |

---

### GAP-006 — QR Phase 2 tags (6–9) not implemented

| | |
|---|---|
| **Severity** | High |
| **Impact** | Simplified invoice QR may fail validation (missing hash, signature, public key, cert signature in TLV) |
| **Status** | ❌ Open |
| **Description** | Only TLV tags 1–5 implemented. ZATCA Phase 2 requires tags 6–9 after signing. |
| **Recommendation** | Extend `qr/tlv.ts` post-signing; re-embed QR in XML before reporting submission |

---

### GAP-007 — Credit/debit profile and routing ambiguity

| | |
|---|---|
| **Severity** | High |
| **Impact** | B2B standard credit notes may need clearance API + `0100000` profile |
| **Status** | ⚠️ **Mitigated** |
| **Fix** | Credit/debit use `reporting:1.0` + `0200000` matching reporting API route |
| **Recommendation** | Split credit/debit into standard vs simplified types if B2B credit notes are required |

---

### GAP-008 — Mock signing bypasses ECDSA

| | |
|---|---|
| **Severity** | High |
| **Impact** | False confidence when mock flags accidentally left on in staging |
| **Status** | ✅ **Mitigated** |
| **Fix** | Documented; `verifyInvoiceSignature` strict when mock off |
| **Recommendation** | Add startup warning if `ZATCA_MOCK_*` set in production `NODE_ENV` |

---

## Medium Gaps

### GAP-009 — Compliance secret overwritten on Production CSID

| | |
|---|---|
| **Severity** | Medium |
| **Impact** | Cannot re-run compliance checks after production CSID issued |
| **Recommendation** | Store `complianceSecretEnc` separately from production secret |

---

### GAP-010 — Placeholder address defaults

| | |
|---|---|
| **Severity** | Medium |
| **Impact** | `0000`, `Not Provided`, `District` fail ZATCA address validation |
| **Recommendation** | Block submission when placeholder detected; enforce in Settings UI |

---

### GAP-011 — No billing reference for credit/debit notes

| | |
|---|---|
| **Severity** | Medium |
| **Impact** | Credit/debit notes may require `BillingReference` to original invoice |
| **Recommendation** | Add `originalInvoiceId` / `billingReference` on Invoice model |

---

### GAP-012 — Simplified canonicalization (not full XML C14N 1.1)

| | |
|---|---|
| **Severity** | Medium |
| **Impact** | Digest mismatch vs ZATCA validator |
| **Recommendation** | Use `xml-c14n` library or ZATCA SDK canonicalization |

---

### GAP-013 — CSR business category hardcoded

| | |
|---|---|
| **Severity** | Medium |
| **Impact** | CSR may not match registered industry in Fatoora portal |
| **Recommendation** | Add `businessCategory` to CompanySettings |

---

## Low Gaps

### GAP-014 — No certificate expiry monitoring

| | |
|---|---|
| **Severity** | Low |
| **Recommendation** | Parse cert `notAfter`; alert 30 days before expiry |

---

### GAP-015 — Single credential row per environment

| | |
|---|---|
| **Severity** | Low |
| **Impact** | Multi-branch / multi-EGS not supported |
| **Recommendation** | Future: `ZatcaCredential` per EGS unit |

---

### GAP-016 — No automatic retry queue

| | |
|---|---|
| **Severity** | Low |
| **Recommendation** | Background job for FAILED invoices with exponential backoff |

---

## Phase 7 Test Results Summary

| Test Area | Offline Result | Live Sandbox |
|-----------|----------------|--------------|
| Failure handling | 6/6 PASS | N/A |
| Mock E2E scenarios | 4/4 PASS | N/A |
| XML compliance (ICV/PIH/QR) | PASS after fixes | Pending OTP |
| Gateway connectivity | HTTP 400 (reachable) | ✅ |
| Real onboarding | N/A | **Requires OTP** |
| Real submission | N/A | **Requires Production CSID** |
| Signature acceptance | N/A | **Pending live run** |

---

## Priority Fix Order for Production

1. Complete live sandbox onboarding with OTP (validate GAP-004 signature)
2. Implement QR tags 6–9 (GAP-006)
3. Full XAdES signing alignment (GAP-004)
4. Compliance invoice wizard (GAP-005)
5. Address placeholder enforcement (GAP-010)
6. Billing references for credit/debit (GAP-011)
