# Complete Application Audit — hisab.ai

**Audit date:** 2026-06-17  
**Scope:** Full codebase inventory for QA and release readiness  
**Stack:** Next.js 16, React 19, Prisma 7, SQLite (dev) / PostgreSQL (prod), ZATCA Phase 2

---

## Executive Summary

hisab.ai is a **single-company** Saudi accounting and e-invoicing application. It includes a full chart of accounts, AR/AP, payroll, inventory, financial reports, and a **ZATCA Phase 2** integration (XML, hash, QR, XAdES signing, onboarding, clearance/reporting).

**Critical QA findings:**

| Area | Risk | Notes |
|------|------|-------|
| Multi-tenant | N/A | **Not implemented** — one `CompanySettings` row, no `tenantId` |
| Page auth | Medium | Dashboard pages load without server auth; APIs return 401 |
| Role-based access | Medium | Roles exist but ZATCA/financial APIs do not enforce them |
| ZATCA live | High | Mock mode default; live acceptance unverified without OTP |
| Test coverage | High | No Jest/Playwright suite; only ZATCA sandbox scripts |
| Products on invoices | Low | Invoice lines are free-text; `InventoryItem` is separate |

---

## 1. Feature Inventory

### Core Accounting

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Chart of Accounts | `/accounts` | `/api/accounts` | Implemented |
| Journal entries | `/journal` | `/api/journal`, `/post`, `/import` | Implemented |
| Double-entry posting | `/journal` | `POST /api/journal/[id]/post` | Implemented |
| Cost centers | `/cost-centers` | `/api/cost-centers` | Implemented |

### Income (AR)

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Customers | `/customers` | `/api/customers` | Implemented |
| Invoices | `/invoices` | `/api/invoices`, `/payment` | Implemented |
| Invoice payments | `/invoices` | `POST /api/invoices/[id]/payment` | Implemented |

### Expenses (AP)

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Vendors | `/vendors` | `/api/vendors` | Implemented |
| Bills | `/bills` | `/api/bills`, `/import`, `/payment` | Implemented |
| Expenses | `/expenses` | `/api/expenses`, `/import` | Implemented |
| Receipts upload | `/receipts` | `/api/receipts` | Implemented |

### Operations

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Employees | `/employees` | `/api/employees` | Implemented |
| Payroll | `/payroll` | `/api/payroll`, `/approve` | Implemented |
| Inventory | `/inventory` | `/api/inventory` | Implemented |

### Reports & Tax

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Reports hub | `/reports` | — | Implemented |
| Profit & Loss | `/reports/profit-loss` | `/api/reports/profit-loss` | Implemented |
| Balance Sheet | `/reports/balance-sheet` | `/api/reports/balance-sheet` | Implemented |
| General Ledger | `/reports/general-ledger` | `/api/reports/general-ledger` | Implemented |
| Cash Flow | `/reports/cash-flow` | `/api/reports/cash-flow` | Implemented |
| Tax rates & VAT report | `/tax` | `/api/tax`, `/api/tax/report` | Implemented |

### ZATCA E-Invoicing

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Company ZATCA settings | `/settings` | `/api/settings` | Implemented |
| ZATCA monitoring | `/zatca` | `/api/zatca/dashboard` | Implemented |
| CSR generation | `/settings` | `POST /api/zatca/onboarding/csr` | Implemented |
| Compliance CSID | `/settings` | `POST /api/zatca/onboarding/compliance` | Mock + live |
| Production CSID | `/settings` | `POST /api/zatca/onboarding/production` | Mock + live |
| Invoice submit | `/invoices` | `POST /api/zatca/invoices/[id]/submit` | Mock + live |
| XML / Hash / QR dev APIs | — | `/api/zatca/invoices/[id]/*` | Implemented |
| Sandbox E2E | `/zatca` | `POST /api/zatca/sandbox/run` | Mock only |
| Audit logs | `/zatca` | via dashboard API | Implemented |

### Administration

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Users | `/users` | `/api/users` | Implemented |
| Settings | `/settings` | `/api/settings` | Implemented |
| Dashboard KPIs | `/` | `/api/dashboard` | Implemented |
| Demo seed | `/` | `POST /api/seed` | **Unauthenticated** |

### Authentication

| Feature | Page | API | Status |
|---------|------|-----|--------|
| Login | `/login` | `POST /api/auth/login` | Implemented |
| Logout | Header menu | `POST /api/auth/logout` | Implemented |
| Session cookie | — | `AppSession` table, 7-day TTL | Implemented |

---

## 2. Route Inventory (Pages)

| URL | File | Module |
|-----|------|--------|
| `/` | `(dashboard)/page.tsx` | Dashboard |
| `/login` | `(auth)/login/page.tsx` | Auth |
| `/accounts` | `(dashboard)/accounts/page.tsx` | Accounting |
| `/journal` | `(dashboard)/journal/page.tsx` | Accounting |
| `/invoices` | `(dashboard)/invoices/page.tsx` | AR + ZATCA |
| `/customers` | `(dashboard)/customers/page.tsx` | AR |
| `/bills` | `(dashboard)/bills/page.tsx` | AP |
| `/expenses` | `(dashboard)/expenses/page.tsx` | AP |
| `/vendors` | `(dashboard)/vendors/page.tsx` | AP |
| `/payroll` | `(dashboard)/payroll/page.tsx` | HR |
| `/employees` | `(dashboard)/employees/page.tsx` | HR |
| `/inventory` | `(dashboard)/inventory/page.tsx` | Inventory |
| `/cost-centers` | `(dashboard)/cost-centers/page.tsx` | Accounting |
| `/receipts` | `(dashboard)/receipts/page.tsx` | AP |
| `/reports` | `(dashboard)/reports/page.tsx` | Reports |
| `/reports/profit-loss` | `(dashboard)/reports/profit-loss/page.tsx` | Reports |
| `/reports/balance-sheet` | `(dashboard)/reports/balance-sheet/page.tsx` | Reports |
| `/reports/general-ledger` | `(dashboard)/reports/general-ledger/page.tsx` | Reports |
| `/reports/cash-flow` | `(dashboard)/reports/cash-flow/page.tsx` | Reports |
| `/tax` | `(dashboard)/tax/page.tsx` | Tax |
| `/zatca` | `(dashboard)/zatca/page.tsx` | ZATCA |
| `/users` | `(dashboard)/users/page.tsx` | Admin |
| `/settings` | `(dashboard)/settings/page.tsx` | Admin + ZATCA |

**Navigation:** Defined in `(dashboard)/layout.tsx` — sidebar sections: Accounting, Income, Expenses, Operations, Reports & Tax, Administration.

**Route guard:** `src/proxy.ts` — redirects unauthenticated users to `/login` except `/api/auth/*` and `/api/seed`.

---

## 3. API Inventory (60 routes)

### Public (no auth)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/seed` | Demo data seed |

### Protected (requireAuth)

All other `/api/*` routes require valid `session` cookie.

**Full list:** See [API_TEST_PLAN.md](./API_TEST_PLAN.md) for method, body, and expected responses per endpoint.

### ZATCA-specific (17 routes)

| Method | Route |
|--------|-------|
| GET | `/api/zatca/dashboard` |
| POST | `/api/zatca/sandbox/run` |
| GET | `/api/zatca/verify/failure-scenarios` |
| POST | `/api/zatca/onboarding/csr` |
| POST | `/api/zatca/onboarding/compliance` |
| POST | `/api/zatca/onboarding/production` |
| GET | `/api/zatca/onboarding/status` |
| POST | `/api/zatca/invoices/[id]/submit` |
| GET | `/api/zatca/invoices/[id]/status` |
| GET | `/api/zatca/invoices/[id]/response` |
| GET | `/api/zatca/invoices/[id]/compliance` |
| POST | `/api/zatca/invoices/[id]/compliance-check` |
| GET | `/api/zatca/invoices/[id]/xml` |
| GET | `/api/zatca/invoices/[id]/hash` |
| GET | `/api/zatca/invoices/[id]/qr` |
| GET | `/api/zatca/invoices/[id]/signed-xml` |

---

## 4. Database Inventory (26 models)

| Model | Purpose | Key unique fields |
|-------|---------|-------------------|
| User | App users | `email` |
| AppSession | Auth sessions | `token` |
| ChartOfAccount | GL accounts | `accountNo` |
| CostCenter | Cost allocation | `code` |
| JournalEntry / JournalLine | GL journals | `entryNo` |
| Customer | AR customers | `customerNo` |
| Vendor | AP vendors | `vendorNo` |
| Invoice / InvoiceLine | Sales invoices | `invoiceNo`, `invoiceUUID` |
| Bill / BillLine | Purchase bills | `billNo` |
| Expense / ExpenseLine | Expenses | `expenseNo` |
| Payment | Invoice/bill payments | `paymentNo` |
| Employee | HR | `employeeNo` |
| PayrollEntry / PayrollLine | Payroll runs | `payrollNo` |
| InventoryItem | Stock items | `itemCode` |
| TaxRate | VAT rates | — |
| Receipt | Uploaded documents | — |
| CompanySettings | **Singleton** company profile | — |
| ZatcaCredential | Per-environment CSID | `environment` |
| ZatcaAuditLog | ZATCA audit trail | — |
| ZatcaSandboxTestRun | Mock E2E results | — |
| Sequence | Document numbering | `type` |

### Enums

- `InvoiceType`: STANDARD, SIMPLIFIED, CREDIT_NOTE, DEBIT_NOTE
- `ZatcaEnvironment`: SANDBOX, PRODUCTION
- `ZatcaOnboardingStatus`: NOT_STARTED → PRODUCTION_ISSUED / FAILED
- `ZatcaInvoiceStatus`: DRAFT → CLEARED / REPORTED / FAILED

---

## 5. Major Workflows

### Invoice lifecycle

```
Create invoice → (optional) Record payment → ZATCA submit → CLEARED/REPORTED
```

### ZATCA onboarding

```
Enable ZATCA → Generate CSR → Compliance OTP → Compliance CSID
→ 6 compliance invoices → Production CSID → Live submission
```

### Journal posting

```
Create DRAFT journal → Validate debits = credits → POST → Updates account balances
```

### Authentication

```
POST /login → session cookie → proxy + requireAuth on APIs
```

---

## 6. Test Data Assets

| Asset | Location | Command |
|-------|----------|---------|
| Base demo seed | `prisma/seed.ts` | `npm run db:seed` |
| Demo transactions | `src/lib/demo-seed.ts` | Included in db:seed |
| QA bulk data | `src/lib/qa-seed.ts` | `npm run qa:seed` |
| Company profiles (manual) | `data/qa-company-profiles.json` | Apply via Settings UI |
| DB integrity checks | `scripts/qa-verify.mjs` | `npm run qa:verify` |

---

## 7. Recommended Test Order (Risk-Based)

1. **Authentication & session** — login, logout, expired session, API 401
2. **Database integrity** — `npm run qa:verify`
3. **Invoice math** — subtotal, VAT, balance, payments
4. **ZATCA pipeline** — mock sandbox E2E, then live OTP path
5. **Company settings** — Saudi address, VAT TRN validation
6. **Financial reports** — P&L, balance sheet tie-out
7. **CRUD modules** — customers, vendors, bills, expenses
8. **CSV imports** — journal, bills, expenses
9. **UI edge cases** — search, pagination, mobile sidebar
10. **Security** — unauthenticated seed endpoint, role bypass

---

## 8. Known Gaps (Not Bugs — Design Limits)

- **No multi-tenant isolation** — all data is global per database
- **No invoice ↔ inventory link** — inventory does not auto-populate invoice lines
- **No billing reference** on credit/debit notes to original invoice
- **Page routes not server-auth** — UI shell loads before API fails
- **No automated regression suite** — manual + ZATCA scripts only
