# ZATCA Phase 2 — Gap Analysis (Day 1)

**Date:** June 2026  
**Scope:** Data model readiness for Saudi ZATCA e-invoicing (Phase 2). No CSR, certificates, XML, QR, hashing, signatures, or API integration.

**Models audited:** `CompanySettings`, `Customer`, `Invoice`, `InvoiceLine`, `TaxRate`

---

## Executive Summary

The existing schema covers core accounting fields (invoice totals, line items, basic company/customer identity) but lacks **Saudi National Address** structure, **ZATCA invoice metadata** (UUID, hash, clearance status), **invoice type classification**, and **environment configuration**. Day 1 schema changes add nullable compliance fields and enums without breaking existing data.

| Entity | Fields present | Fields missing (pre-Day-1) | Coverage after Day 1 |
|--------|----------------|---------------------------|----------------------|
| CompanySettings | 6 / 11 | 5 | 11 / 11 |
| Customer | 4 / 9 | 5 | 9 / 9 |
| Invoice | 8 / 14 | 6 | 14 / 14 |
| InvoiceLine | Adequate for Phase 2 prep | — | No change required |
| TaxRate | Adequate for Phase 2 prep | — | No change required |

---

## CompanySettings

ZATCA requires the **seller (supplier)** party to have a complete legal identity and Saudi National Address for e-invoice XML.

| ZATCA Requirement | Existing Field | Status | Recommended Change |
|-------------------|----------------|--------|-------------------|
| Legal Company Name | `legalName` (nullable) | Partial | Keep; ensure populated before go-live |
| VAT Registration Number | `taxId` (nullable) | Partial | Keep `taxId` as VAT TRN field |
| Commercial Registration Number | — | **Missing** | Add `commercialRegistration String?` |
| Country | `country` (default "Saudi Arabia") | Present | Keep |
| City | `city` (nullable) | Partial | Keep |
| District | — | **Missing** | Add `district String?` |
| Street Address | `address` (nullable, unstructured) | Partial | Add `streetAddress String?`; retain `address` for backward compatibility |
| Building Number | — | **Missing** | Add `buildingNumber String?` |
| Postal Code | — | **Missing** | Add `postalCode String?` |
| ZATCA enabled flag | `zatcaEnabled` | Present | Keep |
| ZATCA environment | — | **Missing** | Add `zatcaEnvironment` enum (`SANDBOX` \| `PRODUCTION`), default `SANDBOX` |

**Additional existing fields (not ZATCA-mandatory but retained):** `companyName`, `phone`, `email`, `currency`, `fiscalYearStart`

---

## Customer

ZATCA requires **buyer** party details on standard tax invoices (B2B). Simplified invoices have reduced buyer requirements (handled later via `InvoiceType`).

| ZATCA Requirement | Existing Field | Status | Recommended Change |
|-------------------|----------------|--------|-------------------|
| Customer Name | `name` | Present | Keep |
| VAT Number | `taxId` (nullable) | Partial | Keep `taxId` as buyer VAT TRN |
| Country | `country` (nullable) | Partial | Keep |
| City | `city` (nullable) | Partial | Keep |
| District | — | **Missing** | Add `district String?` |
| Street Address | `address` (nullable, unstructured) | Partial | Add `streetAddress String?`; retain `address` |
| Building Number | — | **Missing** | Add `buildingNumber String?` |
| Postal Code | — | **Missing** | Add `postalCode String?` |

**Additional existing fields (retained):** `customerNo`, `email`, `phone`, `creditLimit`, `paymentTerms`

---

## Invoice

ZATCA e-invoices require document identity, timing, currency, tax totals, line items, and submission lifecycle metadata.

| ZATCA Requirement | Existing Field | Status | Recommended Change |
|-------------------|----------------|--------|-------------------|
| Invoice Number | `invoiceNo` (unique) | Present | Keep |
| Invoice UUID | — | **Missing** | Add `invoiceUUID String? @unique`; auto-generated on create |
| Issue Date | `date` | Present | Keep |
| Issue Time | — | **Missing** | Add `issueTime String?` (HH:mm:ss, derived from issue datetime) |
| Currency | — (only on CompanySettings) | **Missing** | Add `currency String @default("SAR")` |
| Customer Information | `customerId` → `Customer` | Present | Keep relation |
| Tax Information | `taxAmount`, line `taxRate` | Present | Keep |
| Line Items | `InvoiceLine[]` | Present | Keep |
| Invoice Total | `total` | Present | Keep |
| VAT Total | `taxAmount` | Present | Keep |
| Invoice Type | — | **Missing** | Add `invoiceType` enum, default `STANDARD` |
| Invoice Hash | — | **Missing** | Add `invoiceHash String?` (populated in later phase) |
| ZATCA Status | — | **Missing** | Add `zatcaStatus String?` |
| Clearance Status | — | **Missing** | Add `clearanceStatus String?` |
| ZATCA Submission Date | — | **Missing** | Add `zatcaSubmissionDate DateTime?` |

**Additional existing fields (retained):** `dueDate`, `status`, `subtotal`, `amountPaid`, `balance`, `notes`, `terms`, recurring fields

### InvoiceType enum (new)

| Value | ZATCA use |
|-------|-----------|
| `STANDARD` | B2B tax invoice (default) |
| `SIMPLIFIED` | B2C simplified tax invoice |
| `CREDIT_NOTE` | Credit note against prior invoice |
| `DEBIT_NOTE` | Debit note against prior invoice |

---

## InvoiceLine

| ZATCA Requirement | Existing Field | Status | Notes |
|-------------------|----------------|--------|-------|
| Line description | `description` | Present | Maps to item name/description |
| Quantity | `quantity` | Present | |
| Unit price | `unitPrice` | Present | |
| Line amount (excl. VAT) | `amount` | Present | |
| VAT rate | `taxRate` | Present | Default 15% (Saudi standard) |
| GL account | `accountId` | Present | Internal accounting, not ZATCA XML |
| Cost center | `costCenterId` | Present | Internal accounting |

**Recommendation:** No schema changes for Day 1. Future phases may add `itemCode`, `unitCode` (UN/ECE), and explicit `taxCategory` per ZATCA codification.

---

## TaxRate

| ZATCA Requirement | Existing Field | Status | Notes |
|-------------------|----------------|--------|-------|
| Tax name | `name` | Present | e.g. "VAT 15%" |
| Tax rate (%) | `rate` | Present | 15% Saudi standard |
| Tax type | `type` (default "VAT") | Present | |
| Default flag | `isDefault` | Present | |
| Active flag | `isActive` | Present | |

**Recommendation:** No schema changes for Day 1. Future phases may add ZATCA tax category codes (`S`, `Z`, `E`, `O`).

---

## Schema Changes Applied (Day 1)

### New enums

```prisma
enum InvoiceType {
  STANDARD
  SIMPLIFIED
  CREDIT_NOTE
  DEBIT_NOTE
}

enum ZatcaEnvironment {
  SANDBOX
  PRODUCTION
}
```

### CompanySettings — fields added

- `commercialRegistration String?`
- `district String?`
- `streetAddress String?`
- `buildingNumber String?`
- `postalCode String?`
- `zatcaEnvironment ZatcaEnvironment @default(SANDBOX)`

### Customer — fields added

- `district String?`
- `streetAddress String?`
- `buildingNumber String?`
- `postalCode String?`

### Invoice — fields added

- `invoiceUUID String? @unique`
- `invoiceHash String?`
- `invoiceType InvoiceType @default(STANDARD)`
- `issueTime String?`
- `currency String @default("SAR")`
- `zatcaStatus String?`
- `clearanceStatus String?`
- `zatcaSubmissionDate DateTime?`

### Application behavior (Day 1)

- `invoiceUUID` auto-generated via `randomUUID()` from Node `crypto` on invoice creation
- `issueTime` set from invoice `date` at creation time
- All new fields nullable (except `currency` and `invoiceType` which have safe defaults)

---

## Out of Scope (Later Phases)

| Phase | Capability |
|-------|------------|
| Day 2+ | CSR generation, OTP onboarding, certificate storage |
| Day 3+ | UBL 2.1 XML generation, TLV QR code, cryptographic hash |
| Day 4+ | Digital signature, ZATCA clearance/reporting API calls |
| Day 5+ | Credit/debit note linking to original invoice, simplified invoice rules |

---

## Pre-Go-Live Data Checklist

Before enabling `zatcaEnabled` in production:

1. Populate `CompanySettings.legalName`, `taxId`, `commercialRegistration`, and full national address
2. Ensure B2B customers have `taxId` and national address fields
3. Verify all new invoices receive `invoiceUUID` and `issueTime`
4. Set `zatcaEnvironment` to `PRODUCTION` only after sandbox validation
5. Backfill `invoiceUUID` for any legacy invoices before submission (optional script, not Day 1)

---

## References

- [ZATCA E-Invoicing Portal](https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx)
- [hisab.ai Product Context](./HISAB_AI_PRODUCT_CONTEXT.md)
- Prisma schema: `prisma/schema.prisma`
