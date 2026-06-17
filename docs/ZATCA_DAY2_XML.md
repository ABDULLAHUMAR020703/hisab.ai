# ZATCA Phase 2 — Day 2: UBL 2.1 XML Generation

**Date:** June 2026  
**Scope:** Convert existing hisab.ai invoices to ZATCA-oriented UBL 2.1 XML.  
**Out of scope:** CSR, certificates, OTP, QR, hashing, digital signatures, ZATCA API calls.

---

## Overview

Day 2 adds a server-side pipeline that:

1. Loads an invoice with customer, company settings, and line items
2. Validates source data
3. Maps to an internal UBL 2.1 document model
4. Validates the mapped document
5. Serializes to XML

---

## File Structure

```
src/lib/zatca/
├── types.ts              # TypeScript interfaces
├── constants.ts          # ZATCA codes, namespaces, tolerances
├── mapper.ts             # Invoice → ZatcaInvoiceDocument
├── generate.ts           # Orchestration pipeline
├── index.ts              # Public exports
└── xml/
    ├── namespaces.ts     # UBL namespace declarations
    ├── escape.ts         # XML escaping
    ├── builder.ts        # Document → XML string
    ├── validator.ts      # Input + document validation
    └── index.ts
```

**Test endpoint:** `GET /api/zatca/invoices/:id/xml`

---

## Test Endpoint

| Query | Response |
|-------|----------|
| `?format=xml` (default) | `application/xml` body |
| `?format=json` | JSON with `xml`, `validation`, `document` |

**Examples:**

```bash
# XML output (requires session cookie after login)
curl -b cookies.txt http://localhost:3000/api/zatca/invoices/{INVOICE_ID}/xml

# JSON output with validation details
curl -b cookies.txt "http://localhost:3000/api/zatca/invoices/{INVOICE_ID}/xml?format=json"
```

**Status codes:**

| Code | Meaning |
|------|---------|
| 200 | XML generated (warnings may be present) |
| 401 | Not authenticated |
| 404 | Invoice not found |
| 422 | Hard validation failure |
| 500 | Server error |

---

## XML Generation Example

Input: invoice `INV-0001`, customer, company settings, line items.

Output (abbreviated):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>clearance:1.0</cbc:ProfileID>
  <cbc:ID>INV-0001</cbc:ID>
  <cbc:UUID>a1b2c3d4-e5f6-7890-abcd-ef1234567890</cbc:UUID>
  <cbc:IssueDate>2025-05-15</cbc:IssueDate>
  <cbc:IssueTime>10:30:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AccountingSupplierParty>...</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>...</cac:AccountingCustomerParty>
  <cac:TaxTotal>...</cac:TaxTotal>
  <cac:LegalMonetaryTotal>...</cac:LegalMonetaryTotal>
  <cac:InvoiceLine>...</cac:InvoiceLine>
</Invoice>
```

---

## Validation Rules

### Input validation (before mapping)

| Code | Severity | Rule |
|------|----------|------|
| `INV_NUMBER_REQUIRED` | error | Invoice number must be present |
| `INV_LINES_REQUIRED` | error | At least one line item required |
| `CUSTOMER_NAME_REQUIRED` | error | Customer name required |
| `SUPPLIER_NAME_REQUIRED` | error | Company legal/display name required |
| `INV_UUID_MISSING` | warning | Missing UUID — temporary UUID generated |
| `SUPPLIER_VAT_MISSING` | warning | Supplier VAT TRN missing |
| `SUPPLIER_VAT_FORMAT` | warning | VAT TRN not 15 digits |
| `SUPPLIER_CRN_MISSING` | warning | Commercial registration missing |
| `CUSTOMER_VAT_MISSING` | warning | Buyer VAT missing on standard invoice |
| `CURRENCY_NOT_SAR` | warning | Currency is not SAR |
| `SUBTOTAL_MISMATCH` | warning | Subtotal ≠ sum of line amounts |
| `TOTAL_MISMATCH` | warning | Total ≠ subtotal + tax |

### Document validation (after mapping)

| Code | Severity | Rule |
|------|----------|------|
| `UBL_VERSION` | error | UBL version must be 2.1 |
| `PROFILE_REQUIRED` | error | ZATCA profile ID required |
| `INV_UUID_INVALID` | error | UUID must be valid RFC 4122 |
| `ISSUE_DATE_INVALID` | error | Issue date format YYYY-MM-DD |
| `ISSUE_TIME_INVALID` | error | Issue time format HH:mm:ss |
| `CURRENCY_REQUIRED` | error | Document currency required |
| `LINE_EXTENSION_MISMATCH` | warning | Line totals vs monetary total |
| `TAX_TOTAL_MISMATCH` | warning | Tax total vs line taxes |
| `TAX_INCLUSIVE_MISMATCH` | warning | Tax inclusive amount reconciliation |

Hard errors block XML output (422). Warnings are returned in JSON format or via `X-ZATCA-Warnings` header count for XML.

---

## Invoice Type Mapping

| Prisma `InvoiceType` | Profile ID | Type Code | Type Name |
|----------------------|------------|-----------|-----------|
| STANDARD | clearance:1.0 | 388 | 0100000 |
| SIMPLIFIED | reporting:1.0 | 388 | 0200000 |
| CREDIT_NOTE | clearance:1.0 | 381 | 0100000 |
| DEBIT_NOTE | clearance:1.0 | 383 | 0100000 |

---

## Programmatic Usage

```typescript
import { generateZatcaInvoiceXml } from '@/lib/zatca'

const result = generateZatcaInvoiceXml({
  id: invoice.id,
  invoiceNo: invoice.invoiceNo,
  invoiceUUID: invoice.invoiceUUID,
  invoiceType: invoice.invoiceType,
  date: invoice.date,
  issueTime: invoice.issueTime,
  currency: invoice.currency,
  subtotal: invoice.subtotal,
  taxAmount: invoice.taxAmount,
  total: invoice.total,
  notes: invoice.notes,
  lines: invoice.lines,
  customer: invoice.customer,
  companySettings,
})

if (result.validation.valid) {
  console.log(result.xml)
}
```

---

## Next Steps (Day 3+, not implemented)

- Cryptographic hash of XML
- Digital signature with CSID certificate
- TLV QR code generation
- ZATCA clearance/reporting API submission

---

## Related Docs

- [ZATCA_GAP_ANALYSIS.md](./ZATCA_GAP_ANALYSIS.md) — Day 1 schema gaps
- [HISAB_AI_PRODUCT_CONTEXT.md](./HISAB_AI_PRODUCT_CONTEXT.md) — Product overview
