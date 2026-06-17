# ZATCA Phase 2 — Day 3: Invoice Hashing & TLV QR

**Date:** June 2026  
**Scope:** SHA-256 invoice hashing, previous-hash chain infrastructure, ZATCA TLV QR payload, and QR image generation.  
**Out of scope:** CSR, certificates, OTP, CSID, digital signatures, ZATCA API calls.

---

## Overview

Day 3 extends the existing pipeline:

```
Invoice → Validation → ZATCA Mapping → UBL 2.1 XML
                                            ↓
                                    SHA-256 Hash
                                            ↓
                              Previous Hash (chain)
                                            ↓
                                    TLV QR Payload
                                            ↓
                                    QR PNG Data URL
```

Hashes are persisted to the database when XML is generated. QR images are **not** stored (no suitable field exists).

---

## Module Structure

```
src/lib/zatca/
├── hash/
│   ├── generator.ts    # generateInvoiceHash(xml)
│   ├── previous.ts     # getPreviousInvoiceHash(invoiceId)
│   └── index.ts
├── qr/
│   ├── tlv.ts          # generateTlvPayload(fields)
│   ├── validator.ts    # validateQrPayloadInput()
│   ├── generator.ts    # generateQrPayload(), generateQrDataUrl()
│   └── index.ts
└── invoice-service.ts  # loadZatcaInvoiceById(), processZatcaInvoice()
```

---

## Dependencies Added

| Package | Purpose |
|---------|---------|
| `qrcode` | PNG QR code data URL generation |
| `@types/qrcode` | TypeScript types (dev) |

---

## Task 2 — Invoice Hash

```typescript
import { generateInvoiceHash } from '@/lib/zatca/hash'

const hash = generateInvoiceHash(xml)
// 64-character lowercase SHA-256 hex string
```

**Properties:**
- Algorithm: SHA-256
- Encoding: UTF-8 input
- Output: lowercase hexadecimal (64 chars)
- Deterministic: same XML → same hash

---

## Task 3 — Previous Hash

```typescript
import { getPreviousInvoiceHash } from '@/lib/zatca/hash'

const previousHash = await getPreviousInvoiceHash(invoiceId)
// Most recent prior invoice hash, or null
```

Looks up the latest invoice (by `createdAt`) before the current one that has a non-null `invoiceHash`. Chain validation is **not** enforced yet.

---

## Task 4 — TLV QR Payload

ZATCA simplified QR uses TLV encoding (Tag-Length-Value) for tags 1–5:

| Tag | Field | Example |
|-----|-------|---------|
| 1 | Seller Name | `NETKOM COMPANY FOR COMMUNICATION LLC` |
| 2 | VAT Number | `300000000000003` |
| 3 | Timestamp | `2025-05-15T10:30:00` |
| 4 | Invoice Total | `1150.00` |
| 5 | VAT Total | `150.00` |

```typescript
import { generateTlvPayload } from '@/lib/zatca/qr'

const payload = generateTlvPayload({
  sellerName: 'NETKOM COMPANY FOR COMMUNICATION LLC',
  vatNumber: '300000000000003',
  timestamp: '2025-05-15T10:30:00',
  invoiceTotal: '1150.00',
  vatTotal: '150.00',
})
// Base64 string
```

---

## Task 5 — QR Code Generator

```typescript
import { generateQrPayload, generateQrDataUrl } from '@/lib/zatca/qr'

const { payload, validation } = generateQrPayload(invoiceInput)
const { payload, qrDataUrl, validation } = await generateQrDataUrl(invoiceInput)
```

`qrDataUrl` is a `data:image/png;base64,...` string suitable for `<img src={qrDataUrl} />`.

---

## Task 6 — Database Persistence

Schema addition on `Invoice`:

| Field | Type | Purpose |
|-------|------|---------|
| `invoiceHash` | `String?` | SHA-256 of UBL XML (Day 1 field, now populated) |
| `previousInvoiceHash` | `String?` | Hash of prior invoice in chain (Day 3) |

Persisted automatically when calling:
- `GET /api/zatca/invoices/:id/xml` (via `processZatcaInvoice`)
- `GET /api/zatca/invoices/:id/hash`

Migration: `prisma/migrations/20250610140000_zatca_phase2_day3/migration.sql`

---

## Task 7 — Test Endpoints

| Endpoint | Response |
|----------|----------|
| `GET /api/zatca/invoices/:id/hash` | `{ invoiceId, hash, previousHash }` |
| `GET /api/zatca/invoices/:id/qr` | `{ payload, qrDataUrl }` |
| `GET /api/zatca/invoices/:id/xml?format=json` | Now includes `hash`, `previousHash` |

All endpoints require authentication (session cookie).

---

## Task 8 — QR Validation

| Code | Rule |
|------|------|
| `QR_SELLER_NAME_REQUIRED` | Seller name must exist |
| `QR_VAT_REQUIRED` | VAT registration number must exist |
| `QR_TIMESTAMP_REQUIRED` | Invoice timestamp must exist |
| `QR_TOTAL_REQUIRED` | Invoice total must exist |
| `QR_VAT_TOTAL_REQUIRED` | VAT total must exist |

Validation errors return HTTP 422 with `{ error, validation }`.

---

## Example Outputs

### Hash (64-char SHA-256)

```
a3f2c8d91e4b7a6053f1d8e92c4b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b
```

*(Actual value depends on generated XML content.)*

### TLV Payload (Base64)

```
ARNETKOM COMPANY FOR COMMUNICATION LLCTAjMwMDAwMDAwMDAwMDAwMzM1DzIwMjUtMDUtMTVUMTA6MzA6MDAFMTE1MC4wMAUGMTUwLjAw
```

### QR Response

```json
{
  "payload": "ARNETKOM COMPANY FOR COMMUNICATION LLCTAjMwMDAwMDAwMDAwMDAwMzM1DzIwMjUtMDUtMTVUMTA6MzA6MDAFMTE1MC4wMAUGMTUwLjAw",
  "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

---

## Programmatic Usage

```typescript
import { processZatcaInvoice } from '@/lib/zatca'

const result = await processZatcaInvoice(invoiceId, { persistHash: true })
// result.xml, result.hash, result.previousHash, result.validation
```

---

## Next Steps (Day 4+, not implemented)

- Digital signature with CSID certificate
- CSR generation and OTP onboarding
- Compliance / production CSID
- ZATCA clearance and reporting API integration
- Full invoice chain validation enforcement

---

## Related Docs

- [ZATCA_GAP_ANALYSIS.md](./ZATCA_GAP_ANALYSIS.md) — Day 1 schema
- [ZATCA_DAY2_XML.md](./ZATCA_DAY2_XML.md) — Day 2 UBL XML generation
