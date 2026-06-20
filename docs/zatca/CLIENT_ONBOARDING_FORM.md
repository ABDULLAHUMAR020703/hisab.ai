+# ZATCA E-Invoicing — Client Information Form

**Product:** hisab.ai  
**Document type:** Client onboarding checklist (simulation & production)  
**Version:** 1.0  
**Last updated:** June 2026  
**Audience:** Taxpayer / client IT contact (e.g. Netkom) and hisab.ai implementer  

---

> **How to use this document**  
> 1. Send this form to the client before ZATCA simulation onboarding.  
> 2. Client completes **Section 4** and returns it.  
> 3. Implementer enters values in **Settings → Company Information** and **Settings → Saudi E-Invoicing** in hisab.ai.  
> 4. Client generates a **fresh OTP** from the Fatoora portal when ready to connect.  
>  
> **Print / PDF:** Open this file in VS Code, Cursor, or GitHub → Print / Export to PDF.  
> For best results, use **A4**, margins **Normal**, enable **Background graphics**.

---

## Table of contents

1. [Overview](#1-overview)  
2. [Prerequisites (client must have)](#2-prerequisites-client-must-have)  
3. [Field reference — what ZATCA requires](#3-field-reference--what-zatca-requires)  
4. [Client completion form](#4-client-completion-form)  
5. [OTP procedure](#5-otp-procedure)  
6. [Implementer checklist (hisab.ai)](#6-implementer-checklist-hisabai)  
7. [After simulation — production go-live](#7-after-simulation--production-go-live)  
8. [Common errors](#8-common-errors)  
9. [Signatures](#9-signatures)  

---

## 1. Overview

Saudi ZATCA Phase 2 e-invoicing onboarding connects **hisab.ai** to the **Fatoora** portal through:

```
Company data → CSR (certificate request) → OTP → Compliance CSID → Test invoices → Production CSID
```

The client (taxpayer) must provide accurate company and **EGS unit** details that **exactly match** their Fatoora portal registration. Incorrect data causes `Invalid-CSR` or `Invalid-OTP` errors.

| Phase | Portal | hisab.ai environment |
|-------|--------|----------------------|
| Testing | [Fatoora **simulation** portal](https://fatoora.zatca.gov.sa) | **Sandbox (Simulation)** |
| Go-live | Fatoora **production** portal | **Production** |

---

## 2. Prerequisites (client must have)

| # | Requirement | Required | Provided by | Notes |
|---|-------------|----------|-------------|-------|
| 2.1 | Fatoora portal account (simulation) | **Yes** | Client | https://fatoora.zatca.gov.sa |
| 2.2 | EGS unit registered in portal | **Yes** | Client | One device/solution unit per onboarding |
| 2.3 | Valid VAT registration (TRN) | **Yes** | Client | 15 digits, starts and ends with `3` |
| 2.4 | Portal user who can generate OTP | **Yes** | Client | OTP valid ~1 hour |
| 2.5 | hisab.ai Settings access | **Yes** | Implementer | Admin login |

---

## 3. Field reference — what ZATCA requires

### 3.1 Company information (Settings → Company Information)

| Field in hisab.ai | ZATCA / CSR use | Required | Format & rules | Example |
|-------------------|-----------------|----------|----------------|---------|
| Legal Name | CSR Organization (`O`) | **Yes** | Exact legal name; **ASCII** (A–Z, 0–9, basic punctuation) | `NETKOM COMPANY FOR COMMUNICATION LLC` |
| Company Name | Fallback if Legal Name empty | Yes* | Trading / display name | Same as legal name |
| Tax ID (VAT TRN) | CSR `UID`; must match portal | **Yes** | **15 digits**; pattern `3xxxxxxxxxxxxx3` | `300000000000003` |
| Commercial Registration (CRN) | Company profile / invoices | Recommended | MOCI registration number | `1010123456` |
| Building Number | National address | Recommended | Saudi national address standard | `7845` |
| Street Address | CSR `registeredAddress` | **Yes** | Street name; ASCII preferred | `King Fahd Road` |
| District | Address; may be CSR `OU` | Recommended | District / neighbourhood | `Al Olaya` |
| City | Address | **Yes** | City name | `Riyadh` |
| Postal Code | National address | Recommended | 5-digit postal code | `12211` |
| Country | Fixed in CSR | **Yes** | Saudi Arabia (`SA`) | `Saudi Arabia` |
| Email | Contact | Recommended | Valid email | `finance@company.sa` |
| Phone | Contact | Recommended | Include country code | `+966501234567` |

\*Required if Legal Name is not provided.

**Address in CSR:** hisab.ai builds `registeredAddress` from:  
`Building Number` + `Street` + `District` + `City` + `Postal Code`  
(or city / `Riyadh` as fallback).

---

### 3.2 ZATCA settings (Settings → Saudi E-Invoicing)

| Field in hisab.ai | ZATCA meaning | Required | What client must provide |
|-------------------|---------------|----------|--------------------------|
| Enable Saudi E-Invoicing | Activates ZATCA workflows | **Yes** | Must be ON before Connect |
| ZATCA Environment | Simulation vs live API | **Yes** | Start with **Sandbox (Simulation)** |
| EGS Unit ID (CSR Common Name) | CSR `CN` — device name in portal | **Yes** | **Exact** EGS / device name from Fatoora portal |
| ZATCA OTP | One-time password for CSID | **Yes** (at Connect) | Fresh OTP from **simulation** portal |

---

### 3.3 CSR technical fields (auto-generated — client must confirm accuracy)

These are embedded in the certificate signing request (CSR). Values must **match** Fatoora portal registration.

| CSR field | Meaning | Source in hisab.ai | Default / notes |
|-----------|---------|-------------------|-----------------|
| `C` | Country | Fixed | `SA` |
| `O` | Organization | Legal Name | — |
| `OU` | Organizational unit | District or City | `Main Branch` if empty |
| `CN` | Common Name | **EGS Unit ID** | If empty: `TST-{VAT}` (simulation) — **often rejected**; use portal name |
| `SN` | EGS serial (in SAN) | Auto | `1-hisab.ai\|2-hisab.ai\|3-{serial}` |
| `UID` | VAT number (in SAN) | Tax ID (VAT TRN) | 15-digit VAT |
| `title` | Invoice types supported | Fixed | `1100` = standard + simplified |
| `registeredAddress` | Branch location (in SAN) | Address fields | Must match portal |
| `businessCategory` | Industry (in SAN) | Fixed* | `Telecommunications` — confirm with portal |
| `certificateTemplateName` | Environment template | Auto | Simulation: `PREZATCA-Code-Signing` |

\*Confirm business category with client’s Fatoora registration; update in implementation if portal differs.

---

### 3.4 Items NOT required from client

| Item | Reason |
|------|--------|
| Private key | Generated and stored securely by hisab.ai |
| CSR file | Generated automatically on Connect |
| Compliance / production certificate | Issued by ZATCA after successful OTP |
| `ZATCA_CREDENTIAL_ENCRYPTION_KEY` | Set by implementer in server environment (`.env`) |
| API base URL | Default: `https://gw-fatoora.zatca.gov.sa` |

---

## 4. Client completion form

**Instructions:** Complete all **Required** fields. Return this section to the hisab.ai implementer.  
Use **English (ASCII)** for CSR fields unless the Fatoora portal explicitly uses Arabic for a given field.

---

### A. Company details

| Field | Required | Client entry |
|-------|----------|--------------|
| Legal company name (English) | **Yes** | |
| Trading / display name (if different) | No | |
| VAT TRN (15 digits) | **Yes** | |
| Commercial Registration (CRN) | Recommended | |
| Company email | Recommended | |
| Company phone | Recommended | |

---

### B. National address (Saudi Arabia)

| Field | Required | Client entry |
|-------|----------|--------------|
| Building number | Recommended | |
| Street name | **Yes** | |
| District | Recommended | |
| City | **Yes** | |
| Postal code | Recommended | |
| Country | **Yes** | Saudi Arabia |

---

### C. ZATCA / Fatoora

| Field | Required | Client entry |
|-------|----------|--------------|
| Target environment (start) | **Yes** | ☐ Simulation (Sandbox) ☐ Production |
| EGS unit name (Fatoora portal) | **Yes** | |
| Branch / OU name (e.g. main branch) | Recommended | |
| Business category (portal) | Recommended | |
| Fatoora portal login email (contact only) | Recommended | |

**EGS unit name** = exact device/solution identifier shown in Fatoora when the EGS unit was registered.  
This becomes the CSR **Common Name (CN)**. It must match **character-for-character**.

---

### D. OTP (complete only when ready to connect)

| Field | Required | Client entry |
|-------|----------|--------------|
| OTP from Fatoora portal | **Yes** | |
| OTP generated at (date & time) | **Yes** | |
| Portal used | **Yes** | ☐ Simulation ☐ Production |

> OTP expires in approximately **1 hour**. Generate a new OTP for each failed or delayed attempt.

---

## 5. OTP procedure

| Step | Who | Action |
|------|-----|--------|
| 1 | Client | Log in to **Fatoora simulation** portal |
| 2 | Client | Open the target **EGS unit** |
| 3 | Client | Generate **OTP** |
| 4 | Client | Send OTP to implementer (secure channel) or enter in Settings |
| 5 | Implementer | **Save** all Settings fields |
| 6 | Implementer | Enter OTP → click **Connect to ZATCA** |
| 7 | Both | Confirm status: **Compliance CSID issued** |

**Rules**

- Simulation OTP → **Sandbox** environment only  
- Production OTP → **Production** environment only  
- One OTP per onboarding attempt; get a **new** OTP after CSR changes or failures  

---

## 6. Implementer checklist (hisab.ai)

| # | Task | Done |
|---|------|------|
| 6.1 | Client form received and validated | ☐ |
| 6.2 | `npx prisma db push` (if `zatcaEgsUnitId` column not yet applied) | ☐ |
| 6.3 | Settings → Company Information filled | ☐ |
| 6.4 | Settings → EGS Unit ID = portal device name | ☐ |
| 6.5 | Settings → ZATCA Environment = Sandbox | ☐ |
| 6.6 | Settings → Enable Saudi E-Invoicing = ON | ☐ |
| 6.7 | `.env`: `ZATCA_MOCK_ONBOARDING=false` (live test) | ☐ |
| 6.8 | `.env`: `ZATCA_CREDENTIAL_ENCRYPTION_KEY` set | ☐ |
| 6.9 | Fresh client OTP entered → Connect to ZATCA | ☐ |
| 6.10 | Onboarding status = Compliance CSID issued | ☐ |

---

## 7. After simulation — production go-live

| # | Requirement | Owner |
|---|-------------|-------|
| 7.1 | Pass **6 compliance test invoices** (ZATCA requirement) | Implementer + client |
| 7.2 | Production Fatoora portal access | Client |
| 7.3 | New CSR for production (`ZATCA-Code-Signing` template) | hisab.ai (auto) |
| 7.4 | Production OTP from Fatoora production portal | Client |
| 7.5 | Switch Settings → ZATCA Environment → **Production** | Implementer |
| 7.6 | Request **Production CSID** in Settings | Implementer |
| 7.7 | PostgreSQL database on production host (recommended) | Implementer |

---

## 8. Common errors

| Error message | Likely cause | Fix |
|---------------|--------------|-----|
| `Invalid-CSR` | CSR fields ≠ Fatoora portal | Fix EGS Unit ID, VAT, address; save; new OTP; Connect again |
| `Invalid-OTP` | Wrong/expired OTP or wrong portal | New OTP from **simulation** portal; use within 1 hour |
| `Unauthorized` | hisab.ai login session lost | Log in again; use PostgreSQL on production/Vercel |
| `ZATCA compliance request failed (400)` | Generic CSR rejection | See Invalid-CSR row |

---

## 9. Signatures

**Client (taxpayer / authorized representative)**

| | |
|---|---|
| Name | |
| Title | |
| Company | |
| Date | |
| Signature | |

**Implementer (hisab.ai)**

| | |
|---|---|
| Name | |
| Date | |
| Signature | |

---

## Document control

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | June 2026 | Initial client onboarding form for simulation & production |

**Related internal docs:** [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) · [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)

---

*End of document*
