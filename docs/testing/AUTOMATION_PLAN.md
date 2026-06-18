# Automation Plan — hisab.ai

**Current state:** No Jest, Vitest, or Playwright configured. ZATCA has CLI scripts only.

---

## 1. What Can Be Automated Today (No New Framework)

| Script | Command | Coverage |
|--------|---------|----------|
| DB integrity | `npm run qa:verify` | FK, totals, duplicates |
| ZATCA failure scenarios | `GET /api/zatca/verify/failure-scenarios` | Validation unit logic |
| ZATCA mock E2E | `POST /api/zatca/sandbox/run` | Full pipeline x4 types |
| Phase 7 verify | `scripts/zatca-phase7-verify.mjs` | Combined offline checks |
| QA seed | `npm run qa:seed` | Test data setup |

**CI recommendation:** Add GitHub Action running:

```yaml
- npm run db:push
- npm run db:seed
- npm run qa:seed
- npm run qa:verify
- npx tsx -r ./scripts/setup-server-only.cjs scripts/zatca-phase7-verify.mjs
```

---

## 2. Recommended Test Stack

| Layer | Tool | Why |
|-------|------|-----|
| Unit tests | **Vitest** | Fast, native ESM, works with Next.js 16 |
| API integration | **Vitest + supertest** or **undici fetch** | Test route handlers |
| E2E UI | **Playwright** | Cross-browser, good Next.js support |
| ZATCA crypto | **Vitest** | Pure functions in `hash/`, `qr/tlv`, `signature/` |
| Load testing | **k6** (optional) | API submission under load |

---

## 3. Unit Tests (Priority 1)

### Target modules (pure logic, no DB)

| Module | Test cases |
|--------|------------|
| `src/lib/zatca/qr/tlv.ts` | TLV encode tags 1–9; length limits; base64 output |
| `src/lib/zatca/hash/zatca-hash.ts` | Hash excludes QR/signature; deterministic |
| `src/lib/zatca/signature/signed-properties.ts` | Hash stability |
| `src/lib/zatca/validation/hardening.ts` | All failure scenarios |
| `src/lib/zatca/validation/xml-compliance.ts` | Profile mismatch detection |
| `src/lib/zatca/xml/escape.ts` | XML entity escaping |
| `src/lib/zatca/onboarding/credential-store.ts` | Encrypt/decrypt round-trip |
| `src/lib/sequences.ts` | Sequence increment (with mock Prisma) |

### Example Vitest setup

```bash
npm install -D vitest @vitejs/plugin-react
```

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

`package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

### Sample test: TLV encoding

```typescript
// src/lib/zatca/qr/tlv.test.ts
import { describe, it, expect } from 'vitest'
import { generateTlvPayload } from './tlv'

describe('generateTlvPayload', () => {
  it('encodes tags 1-5', () => {
    const payload = generateTlvPayload({
      sellerName: 'Test Co',
      vatNumber: '300000000000003',
      timestamp: '2026-06-17T12:00:00',
      invoiceTotal: '1150.00',
      vatTotal: '150.00',
    })
    expect(payload).toBeTruthy()
    const decoded = Buffer.from(payload, 'base64')
    expect(decoded[0]).toBe(1) // tag 1
  })
})
```

---

## 4. Integration Tests (Priority 2)

### API route testing

Use in-memory SQLite + seed before each suite:

```typescript
// tests/api/invoices.test.ts
describe('POST /api/invoices', () => {
  it('creates invoice with correct totals', async () => {
    const session = await loginAsAdmin()
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { Cookie: session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* ... */ }),
    })
    expect(res.status).toBe(200)
    const inv = await res.json()
    expect(inv.total).toBe(1150)
  })
})
```

### Priority API suites

1. `/api/auth/login` — auth flow
2. `/api/invoices` — CRUD + payment math
3. `/api/zatca/invoices/[id]/xml` — XML validation
4. `/api/zatca/sandbox/run` — mock E2E
5. `/api/settings` — ZATCA flags

---

## 5. E2E Tests (Priority 3) — Playwright

### Setup

```bash
npm install -D @playwright/test
npx playwright install
```

### Critical user journeys

| ID | Journey | Steps |
|----|---------|-------|
| E2E-01 | Login → dashboard | Login, verify KPIs |
| E2E-02 | Create invoice | Customer select, line item, save |
| E2E-03 | Record payment | Pay full amount, balance zero |
| E2E-04 | ZATCA mock submit | Enable ZATCA, CSR, submit invoice |
| E2E-05 | Reports P&L | Navigate, set dates, verify chart |
| E2E-06 | Logout | Session cleared |

### Example Playwright spec

```typescript
// e2e/invoices.spec.ts
import { test, expect } from '@playwright/test'

test('create invoice', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[name=email]', 'admin@hisab.ai')
  await page.fill('[name=password]', 'admin123')
  await page.click('button[type=submit]')
  await page.goto('/invoices')
  // ... interact with form
})
```

---

## 6. ZATCA-Specific Automation

### Already automated (keep in CI)

| Test | Assert |
|------|--------|
| `runFailureScenarios()` | 6/6 pass |
| `runAllSandboxScenarios()` | 4/4 pass |
| `verifyInvoiceSignature` | true in mock mode |

### To add

| Test | Type | File |
|------|------|------|
| Golden XML snapshot | Unit | Compare XML output to fixture |
| Hash golden file | Unit | Known invoice → known hash |
| QR TLV decode | Unit | Round-trip tag values |
| Compliance endpoint | Integration | Mock 200 + PASS |

### Live ZATCA (manual gate, not CI)

- Run once per release with real OTP
- Document in [ZATCA_SANDBOX_TEST_RESULTS.md](../ZATCA_SANDBOX_TEST_RESULTS.md)

---

## 7. Test Data Automation

| Command | Purpose |
|---------|---------|
| `npm run db:seed` | Base COA + users |
| `npm run qa:seed` | 50 customers, 100 items, 100 invoices |
| `npm run qa:seed -- --force` | Reset QA data |

---

## 8. Implementation Roadmap

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Phase A** | 1 week | Vitest + 20 unit tests (ZATCA pure functions) |
| **Phase B** | 1 week | CI pipeline with qa:verify + zatca-phase7 |
| **Phase C** | 2 weeks | API integration tests (invoices, auth, settings) |
| **Phase D** | 2 weeks | Playwright E2E (6 critical journeys) |
| **Phase E** | Ongoing | Golden files for XML/hash; live sandbox gate |

---

## 9. Coverage Targets (Release)

| Area | Target |
|------|--------|
| ZATCA pure functions | 80%+ |
| API routes | 60%+ (critical paths) |
| E2E journeys | 6 flows |
| UI pages | Smoke only |

---

## 10. What NOT to Automate (Yet)

- Live ZATCA OTP onboarding (requires human portal)
- Visual PDF invoice rendering (not implemented)
- Multi-tenant isolation (feature doesn't exist)
- Performance at scale (single-tenant first)
