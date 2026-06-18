# API Test Plan — hisab.ai

**Base URL:** `http://localhost:3000`  
**Auth:** Cookie `session=<token>` from login response  
**Content-Type:** `application/json` unless noted

---

## Authentication Setup (Postman / curl)

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@hisab.ai",
  "password": "admin123"
}
```

**Expected:** `200` + `Set-Cookie: session=...`  
**Failure:** `401` invalid credentials, `403` inactive user

### Use session in subsequent requests

Postman: enable cookie jar.  
curl: `-b "session=YOUR_TOKEN"`

---

## Auth Endpoints

| Method | Route | Auth | Body | Expected 200 | Failure |
|--------|-------|------|------|--------------|---------|
| POST | `/api/auth/login` | No | `{ email, password }` | `{ user: { id, email, role } }` | 401 bad creds |
| POST | `/api/auth/logout` | Cookie | — | `{ success: true }` | — |

---

## Dashboard & Seed

| Method | Route | Auth | Expected |
|--------|-------|------|----------|
| GET | `/api/dashboard` | Yes | KPIs, charts, activity arrays |
| POST | `/api/seed` | **No** | Demo data seeded |

---

## Accounts

| Method | Route | Body (POST/PUT) | Expected |
|--------|-------|-----------------|----------|
| GET | `/api/accounts` | — | Array of accounts |
| GET | `/api/accounts?search=110` | — | Filtered |
| POST | `/api/accounts` | `{ accountNo, name, fullName, accountType, subType }` | Created account |
| GET | `/api/accounts/[id]` | — | Single account |
| PUT | `/api/accounts/[id]` | Partial fields | Updated |
| DELETE | `/api/accounts/[id]` | — | Deleted or 409 if in use |

**Failure:** 400 missing fields, 401 no auth, 409 duplicate accountNo

---

## Journal

| Method | Route | Body | Expected |
|--------|-------|------|----------|
| GET | `/api/journal` | — | Entry list |
| POST | `/api/journal` | `{ date, description, lines: [{ accountId, debit, credit }] }` | DRAFT entry |
| GET | `/api/journal/[id]` | — | Entry + lines |
| PUT | `/api/journal/[id]` | Update fields | Updated |
| DELETE | `/api/journal/[id]` | — | Deleted |
| POST | `/api/journal/[id]/post` | — | Status POSTED |
| POST | `/api/journal/import` | CSV multipart | Import result |

**Failure:** Unbalanced journal, 401

---

## Invoices

| Method | Route | Body | Expected |
|--------|-------|------|----------|
| GET | `/api/invoices` | — | Invoice array |
| GET | `/api/invoices?status=PAID` | — | Filtered |
| POST | `/api/invoices` | See below | Created invoice |
| GET | `/api/invoices/[id]` | — | Invoice + lines |
| PUT | `/api/invoices/[id]` | Update | Updated |
| DELETE | `/api/invoices/[id]` | — | Deleted |
| POST | `/api/invoices/[id]/payment` | `{ amount, method, reference? }` | Payment recorded |

### POST /api/invoices example

```json
{
  "customerId": "<customer-uuid>",
  "date": "2026-06-17",
  "dueDate": "2026-07-17",
  "invoiceType": "SIMPLIFIED",
  "lines": [
    {
      "description": "Service fee",
      "quantity": 1,
      "unitPrice": 1000,
      "taxRate": 15
    }
  ],
  "notes": "API test invoice"
}
```

**Expected:** `201/200` with `invoiceNo`, `total`, `balance`

---

## Customers / Vendors / Bills / Expenses

Same CRUD pattern: `GET/POST` collection, `GET/PUT/DELETE` by id.

| Resource | Route prefix |
|----------|--------------|
| Customers | `/api/customers` |
| Vendors | `/api/vendors` |
| Bills | `/api/bills` + `/payment`, `/import` |
| Expenses | `/api/expenses` + `/import` |
| Employees | `/api/employees` |
| Payroll | `/api/payroll` + `/[id]/approve` |
| Inventory | `/api/inventory` |
| Cost centers | `/api/cost-centers` |
| Receipts | `/api/receipts` (multipart POST) |
| Users | `/api/users` |
| Settings | `/api/settings` |
| Tax | `/api/tax`, `/api/tax/report` |

---

## Reports

| Method | Route | Query params | Expected |
|--------|-------|--------------|----------|
| GET | `/api/reports/profit-loss` | `from`, `to` (ISO dates) | P&L sections |
| GET | `/api/reports/balance-sheet` | `asOf` | Assets/liabilities/equity |
| GET | `/api/reports/general-ledger` | `accountId`, `from`, `to` | Ledger lines |
| GET | `/api/reports/cash-flow` | `from`, `to` | Cash flow data |

**Failure:** 400 missing params

---

## ZATCA Endpoints

### Dashboard & testing

| Method | Route | Expected |
|--------|-------|----------|
| GET | `/api/zatca/dashboard` | `{ stats, recentActivity, auditLogs, sandboxTests }` |
| POST | `/api/zatca/sandbox/run` | `{ results: [...], passed: N }` |
| GET | `/api/zatca/verify/failure-scenarios` | `{ scenarios: [...] }` |

### Onboarding

| Method | Route | Body | Expected |
|--------|-------|------|----------|
| POST | `/api/zatca/onboarding/csr` | — | CSR generated |
| POST | `/api/zatca/onboarding/compliance` | `{ otp: "123456" }` | Compliance CSID (mock/live) |
| POST | `/api/zatca/onboarding/production` | — | Production CSID |
| GET | `/api/zatca/onboarding/status` | — | Status flags, no secrets |

### Per-invoice

| Method | Route | Expected |
|--------|-------|----------|
| POST | `/api/zatca/invoices/[id]/submit` | Submission result |
| GET | `/api/zatca/invoices/[id]/status` | `{ zatcaStatus, canSubmit }` |
| GET | `/api/zatca/invoices/[id]/response` | Response metadata |
| GET | `/api/zatca/invoices/[id]/compliance` | Offline compliance result |
| POST | `/api/zatca/invoices/[id]/compliance-check` | ZATCA compliance API result |
| GET | `/api/zatca/invoices/[id]/xml?format=json` | XML + validation |
| GET | `/api/zatca/invoices/[id]/hash` | Hash hex |
| GET | `/api/zatca/invoices/[id]/qr` | TLV + PNG data URL |
| GET | `/api/zatca/invoices/[id]/signed-xml` | Stored signed XML |

### Submit failure cases

| Condition | Expected error code |
|-----------|---------------------|
| No credentials | `MISSING_CREDENTIALS` |
| Already submitted | `ALREADY_SUBMITTED` |
| Invalid data | `VALIDATION_FAILED` |
| Bad signature | `INVALID_SIGNATURE` |

---

## Postman Collection Structure

```
hisab.ai/
├── Auth/
│   ├── Login
│   └── Logout
├── Core/
│   ├── Dashboard
│   ├── Accounts CRUD
│   ├── Invoices CRUD + Payment
│   └── Customers CRUD
├── Reports/
│   ├── P&L
│   ├── Balance Sheet
│   ├── GL
│   └── Cash Flow
└── ZATCA/
    ├── Onboarding Flow
    ├── Invoice Pipeline
    └── Sandbox Run
```

### Environment variables (Postman)

| Variable | Value |
|----------|-------|
| `baseUrl` | `http://localhost:3000` |
| `session` | (from login cookie) |
| `invoiceId` | (from create invoice) |
| `customerId` | (from list customers) |

---

## curl Examples

```bash
# Login and save cookie
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hisab.ai","password":"admin123"}'

# List invoices
curl -b cookies.txt http://localhost:3000/api/invoices

# ZATCA sandbox
curl -b cookies.txt -X POST http://localhost:3000/api/zatca/sandbox/run

# Failure scenarios (no DB required)
curl -b cookies.txt http://localhost:3000/api/zatca/verify/failure-scenarios
```

---

## Response Code Matrix

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Validation / bad request |
| 401 | Not authenticated |
| 404 | Resource not found |
| 422 | ZATCA validation failed |
| 500 | Server error |
