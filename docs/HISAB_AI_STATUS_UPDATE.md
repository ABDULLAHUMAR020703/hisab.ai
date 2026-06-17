# hisab.ai — Project Status Update

**Date:** June 2026  
**Product:** hisab.ai — Small-business accounting platform (Saudi Arabia–ready)  
**Repository:** [github.com/ABDULLAHUMAR020703/hisab.ai](https://github.com/ABDULLAHUMAR020703/hisab.ai)

---

## Executive Summary

hisab.ai is a full-stack accounting web application for small businesses: invoicing, expenses, payroll, inventory, financial reports, and tax compliance. The core product is functional for day-to-day bookkeeping.

The main recent focus has been **ZATCA Phase 2 e-invoicing** — Saudi Arabia’s electronic invoicing requirements. That integration is **feature-complete for development and mock testing**, with **operational tooling** (monitoring, audit logs, validation) in place. **Live ZATCA sandbox onboarding** (OTP from the Fatoora portal) is the remaining step before production go-live.

---

## Platform Overview

| Area | Status |
|------|--------|
| Dashboard & financial overview | ✅ Available |
| Chart of accounts & journal entries | ✅ Available |
| Customers, invoices, payments | ✅ Available |
| Vendors, bills, expenses | ✅ Available |
| Payroll, employees, inventory | ✅ Available |
| Financial reports (P&L, balance sheet, etc.) | ✅ Available |
| Company settings & user roles | ✅ Available |
| ZATCA e-invoicing integration | ✅ Built; live sandbox pending OTP |

**Technology:** Next.js 16, React 19, Prisma 7, SQLite (dev) / PostgreSQL-ready for production.

---

## ZATCA E-Invoicing — Work Completed

Integration was delivered in **seven phases** (Days 1–7). Below is what each phase delivered.

### Phase 1 — Data model & foundation
- Extended database schema for ZATCA fields (company, customer, invoice)
- Invoice UUID, invoice types (standard, simplified, credit note, debit note)
- Environment settings (sandbox vs production)
- Gap analysis and migration baseline

### Phase 2 — UBL 2.1 XML generation
- Server-side pipeline: invoice → validated UBL 2.1 XML
- Supplier/customer parties, VAT, line items, totals
- Test API: view generated XML per invoice

### Phase 3 — Hashing & QR codes
- SHA-256 invoice hashing with previous-invoice chain (PIH)
- TLV QR payload generation (Phase 1 tags)
- QR image generation for display and printing

### Phase 4 — Onboarding & credentials
- ECDSA secp256k1 CSR generation (ZATCA-aligned)
- OTP-based compliance CSID request
- Encrypted credential storage (private key, certificate, secret)
- Settings UI: enable ZATCA, environment, connect flow

### Phase 5 — Signing & submission
- XML digital signing (XAdES-style UBL extensions)
- Production CSID request flow
- Clearance API (standard invoices → **CLEARED**)
- Reporting API (simplified / credit / debit → **REPORTED**)
- Full submit workflow from invoice UI
- Invoice status tracking (request ID, response, signed XML)

### Phase 6 — Operations & production readiness
- **ZATCA Monitor** dashboard (`/zatca`): submitted, cleared, reported, failed, pending
- Audit logging (CSR, CSID, submissions, failures)
- Validation hardening (company, customer, invoice, XML, credentials)
- Structured failure handling (`FAILED` status + diagnostic codes)
- Automated mock E2E tests (4 scenarios — all passing)
- Production readiness and sandbox test documentation

### Phase 7 — Real sandbox verification & compliance fixes
- Code audit against ZATCA Fatoora requirements
- **Compliance fixes:** ICV, PIH, QR in XML; UBL signature stub; correct hash algorithm; sandbox production CSID API path
- Compliance invoice API client (pre–production CSID step)
- XML compliance checker and failure-scenario tests (6/6 passing offline)
- Gateway connectivity verified (`gw-fatoora.zatca.gov.sa`)
- Compliance gap report, release checklist, live sandbox procedures

---

## What Works Today

### For accountants / business users
- Create and manage invoices with VAT and line items
- Open invoice → view ZATCA status, request ID, response messages
- View XML, signed XML, and QR from the invoice screen
- Submit invoices to ZATCA (when onboarded and mock mode is off)
- Monitor submissions on **ZATCA Monitor** (`/zatca`)
- Configure ZATCA in Settings (VAT, CRN, address, environment)

### For developers / operations
- 14+ ZATCA API routes (onboarding, XML, hash, QR, submit, dashboard, compliance)
- Mock mode for local development (`ZATCA_MOCK_ONBOARDING`, `ZATCA_MOCK_SUBMISSION`)
- Verification scripts: `scripts/zatca-phase7-verify.mjs`, `scripts/run-zatca-sandbox.mjs`
- Prisma migrations through Phase 7
- Full documentation under `docs/`

### Automated test results (offline / mock)
| Test | Result |
|------|--------|
| Standard invoice → clearance → CLEARED | ✅ Pass |
| Simplified invoice → reporting → REPORTED | ✅ Pass |
| Credit note → REPORTED | ✅ Pass |
| Debit note → REPORTED | ✅ Pass |
| Validation failure scenarios (6 cases) | ✅ Pass |
| XML compliance (ICV, PIH, QR, namespaces) | ✅ Pass after Phase 7 fixes |

---

## What Is Not Done Yet (Before Production)

| Item | Notes |
|------|--------|
| **Live Fatoora sandbox onboarding** | Requires OTP from [Fatoora Simulation Portal](https://fatoora.zatca.gov.sa/); procedure documented |
| **6 compliance invoice checks** | Required by ZATCA before Production CSID; endpoint exists (`POST .../compliance-check`) |
| **Live clearance/reporting proof** | Pending Production CSID and real submissions |
| **Full XAdES signing parity** | Simplified signer may need alignment with ZATCA SDK for live acceptance |
| **QR Phase 2 tags (6–9)** | Hash/signature/certificate in QR TLV — not yet implemented |
| **Production deployment** | PostgreSQL, encryption key, mock flags off — see release checklist |

Details: `docs/ZATCA_COMPLIANCE_GAP_REPORT.md`

---

## Production Readiness Assessment

| Dimension | Assessment |
|-----------|------------|
| Core accounting product | **Ready** for use |
| ZATCA data model & APIs | **Ready** |
| ZATCA XML & validation | **Strong**; minor spec gaps remain |
| ZATCA signing | **Needs live sandbox validation** |
| Operations (audit, monitoring, errors) | **Ready** |
| Documentation | **Complete** for handoff and deployment |

**Overall:** Suitable for **internal demo, mock testing, and staged rollout**. Recommend one successful **live simulation onboarding + pilot invoices** before production Fatoora.

---

## Environment & Deployment (Summary)

```env
DATABASE_URL="file:./dev.db"                    # dev; use PostgreSQL in production
ZATCA_CREDENTIAL_ENCRYPTION_KEY=<required>      # encrypts CSID secrets at rest
ZATCA_API_BASE_URL=https://gw-fatoora.zatca.gov.sa
ZATCA_MOCK_ONBOARDING=true                      # dev only; must be false for real ZATCA
ZATCA_MOCK_SUBMISSION=true                      # dev only; must be false for real ZATCA
```

**Deploy steps:** backup DB → `npx prisma migrate deploy` → set env vars → build → pilot submit → monitor `/zatca`.

Full checklist: `docs/ZATCA_RELEASE_CHECKLIST.md`

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [HISAB_AI_PRODUCT_CONTEXT.md](./HISAB_AI_PRODUCT_CONTEXT.md) | Full product & architecture |
| [ZATCA_DAY6_FINAL.md](./ZATCA_DAY6_FINAL.md) | ZATCA architecture & API reference |
| [ZATCA_SANDBOX_TEST_RESULTS.md](./ZATCA_SANDBOX_TEST_RESULTS.md) | Mock E2E test results |
| [ZATCA_PHASE7_REAL_SANDBOX.md](./ZATCA_PHASE7_REAL_SANDBOX.md) | Live sandbox verification steps |
| [ZATCA_COMPLIANCE_GAP_REPORT.md](./ZATCA_COMPLIANCE_GAP_REPORT.md) | Open compliance items |
| [ZATCA_RELEASE_CHECKLIST.md](./ZATCA_RELEASE_CHECKLIST.md) | Go-live checklist |
| [ZATCA_PRODUCTION_READINESS.md](./ZATCA_PRODUCTION_READINESS.md) | Pre-production verification |

---

## Recommended Next Steps

1. **Obtain Fatoora simulation OTP** and complete onboarding (CSR → compliance CSID).
2. **Submit 6 compliance invoices** (standard/simplified × sales/credit/debit) via compliance-check API.
3. **Request Production CSID** and run pilot standard + simplified submissions.
4. **Record live request IDs and responses** in `ZATCA_PHASE7_REAL_SANDBOX.md`.
5. **Address open gaps** (QR tags 6–9, full XAdES) if live sandbox rejects signatures.
6. **Plan production deploy** using release checklist (PostgreSQL, encryption key, backups).

---

## Contact / Handoff Notes

- All ZATCA logic lives in `src/lib/zatca/` with API routes under `src/app/api/zatca/`.
- UI entry points: **Settings (Tax & ZATCA)**, **Invoices (view/submit)**, **ZATCA Monitor** (`/zatca`).
- Mock tests do **not** prove live ZATCA acceptance; treat `ZATCA_SANDBOX_TEST_RESULTS.md` as pipeline verification only.

---

*This document reflects the codebase and documentation as of June 2026. For technical deep-dives, see the linked docs in `docs/`.*
