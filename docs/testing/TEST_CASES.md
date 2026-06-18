# Test Cases — hisab.ai

**Version:** 1.0  
**Total cases:** 85+ organized by module  
**Pass criteria:** Expected result matches actual; no console errors; data persists after refresh

---

## How to Use

- Mark each case: **PASS** / **FAIL** / **BLOCKED** / **SKIP**
- Record tester name, date, build/commit hash
- Run `npm run db:seed` then `npm run qa:seed` before functional testing
- Use demo logins: `admin@hisab.ai` / `admin123`, `accountant@hisab.ai` / `accountant123`

---

## 1. Authentication (AUTH)

### AUTH-001 — Valid login

| Field | Value |
|-------|-------|
| **Objective** | Verify successful login sets session |
| **Steps** | 1. Open `/login` 2. Enter `admin@hisab.ai` / `admin123` 3. Submit |
| **Expected** | Redirect to `/`; dashboard loads with KPIs |
| **Pass** | Dashboard data visible; no 401 errors in network tab |

### AUTH-002 — Invalid password

| Steps | Enter valid email, wrong password |
| **Expected** | Error message; remain on login page |
| **Pass** | No session cookie set |

### AUTH-003 — Logout

| Steps | Click user menu → Sign out |
| **Expected** | Redirect to `/login`; subsequent API calls return 401 |
| **Pass** | Cannot access dashboard without re-login |

### AUTH-004 — Session persistence

| Steps | Login → close browser → reopen within 7 days |
| **Expected** | Still authenticated (if cookie not cleared) |
| **Pass** | Session valid or graceful redirect to login |

### AUTH-005 — Unauthenticated API

| Steps | `curl` GET `/api/invoices` without cookie |
| **Expected** | HTTP 401 `{ "error": "Unauthorized" }` |
| **Pass** | 401 returned |

---

## 2. Dashboard (DASH)

### DASH-001 — KPI load

| Steps | Login → view `/` |
| **Expected** | Revenue, expenses, AR, AP cards populate |
| **Pass** | Numbers are numeric (not NaN); charts render |

### DASH-002 — Demo seed button

| Steps | Click seed demo data (if shown) |
| **Expected** | Success message; counts increase |
| **Pass** | No duplicate COA errors |

---

## 3. Chart of Accounts (COA)

### COA-001 — List accounts

| Steps | Open `/accounts` |
| **Expected** | ~70+ accounts from seed |
| **Pass** | Search by code/name works |

### COA-002 — Create account

| Steps | Add account `99-9999`, type Expense |
| **Expected** | Account appears in list |
| **Pass** | Duplicate account number rejected |

### COA-003 — Edit account

| Steps | Edit account name |
| **Expected** | Name updates; accountNo unchanged |
| **Pass** | Persisted after refresh |

### COA-004 — Delete unused account

| Steps | Delete account with no journal lines |
| **Expected** | Account removed |
| **Pass** | Delete succeeds |

### COA-005 — Delete account with dependencies

| Steps | Delete account used on invoice line |
| **Expected** | Error or blocked |
| **Pass** | Account not orphaned in DB |

---

## 4. Journal (JRN)

### JRN-001 — Create draft entry

| Steps | Create balanced journal (debit = credit) |
| **Expected** | Status DRAFT |
| **Pass** | Totals match |

### JRN-002 — Unbalanced entry rejected

| Steps | Create entry where debit ≠ credit |
| **Expected** | Validation error |
| **Pass** | Not saved as POSTED |

### JRN-003 — Post journal

| Steps | Post draft entry |
| **Expected** | Status POSTED; account balances update |
| **Pass** | GL report reflects entry |

### JRN-004 — CSV import

| Steps | Import valid journal CSV |
| **Expected** | Entries created |
| **Pass** | Count increases |

---

## 5. Customers (CUST)

### CUST-001 — Create business customer with VAT

| Steps | Add customer with 15-digit VAT TRN |
| **Expected** | Saved with taxId |
| **Pass** | Appears in invoice customer dropdown |

### CUST-002 — Create customer without VAT

| Steps | Leave taxId empty |
| **Expected** | Saved; ZATCA may warn on standard invoice |
| **Pass** | Customer usable for simplified invoices |

### CUST-003 — Saudi address fields

| Steps | Fill street, building, district, city, postal |
| **Expected** | All fields persist |
| **Pass** | Visible on edit |

### CUST-004 — Search customers

| Steps | Search partial name |
| **Expected** | Filtered list |
| **Pass** | Correct matches only |

### CUST-005 — Delete customer with invoices

| Steps | Delete customer linked to invoice |
| **Expected** | Blocked (FK restrict) |
| **Pass** | Customer remains |

---

## 6. Invoices (INV)

### INV-001 — Create standard invoice

| Steps | New invoice, 1 line, 15% VAT |
| **Expected** | subtotal + tax = total; balance = total |
| **Pass** | Math correct to 2 decimals |

### INV-002 — Create simplified invoice

| Steps | Set invoice type SIMPLIFIED |
| **Expected** | Saved with type |
| **Pass** | ZATCA routes to reporting |

### INV-003 — Credit note

| Steps | Create CREDIT_NOTE invoice |
| **Expected** | Type saved |
| **Pass** | XML profile `reporting:1.0` |

### INV-004 — Debit note

| Steps | Create DEBIT_NOTE invoice |
| **Expected** | Type saved |
| **Pass** | Same as credit note routing |

### INV-005 — Record full payment

| Steps | Pay invoice in full |
| **Expected** | balance = 0; status PAID |
| **Pass** | Payment record created |

### INV-006 — Partial payment

| Steps | Pay 50% of total |
| **Expected** | balance = remainder |
| **Pass** | amountPaid + balance = total |

### INV-007 — Overdue status

| Steps | Create invoice with past due date |
| **Expected** | Shows OVERDUE or equivalent |
| **Pass** | Dashboard aging reflects it |

### INV-008 — Draft invoice

| Steps | Save without sending |
| **Expected** | Status DRAFT |
| **Pass** | Not submitted to ZATCA |

### INV-009 — Invoice search

| Steps | Search by invoice number |
| **Expected** | Correct invoice found |
| **Pass** | Filter works |

### INV-010 — Void/delete draft

| Steps | Delete DRAFT invoice |
| **Expected** | Removed from list |
| **Pass** | Lines cascade deleted |

---

## 7. Tax / VAT (TAX)

### TAX-001 — List tax rates

| Steps | Open `/tax` |
| **Expected** | VAT 15%, 5%, Zero, Exempt from seed |
| **Pass** | Rates display |

### TAX-002 — Create tax rate

| Steps | Add custom rate |
| **Expected** | Appears in list |
| **Pass** | Available on invoice lines |

### TAX-003 — VAT report

| Steps | Run VAT summary |
| **Expected** | Collected vs paid totals |
| **Pass** | Numbers reconcile with invoices |

---

## 8. Settings (SET)

### SET-001 — Update company name

| Steps | Change company name → Save |
| **Expected** | Persists on reload |
| **Pass** | Reflected in ZATCA XML seller name |

### SET-002 — Enable ZATCA

| Steps | Toggle ZATCA enabled |
| **Expected** | Saved; onboarding UI appears |
| **Pass** | `zatcaEnabled: true` in API |

### SET-003 — Saudi address validation

| Steps | Enter placeholder `0000` in building |
| **Expected** | Warning on ZATCA submit (if enforced) |
| **Pass** | Documented in compliance check |

### SET-004 — Switch ZATCA environment

| Steps | Toggle SANDBOX / PRODUCTION |
| **Expected** | Saved separately per credential row |
| **Pass** | Onboarding status reflects environment |

### SET-005 — Apply QA company profile

| Steps | Copy values from `data/qa-company-profiles.json` (construction) into Settings |
| **Expected** | All fields save |
| **Pass** | Used in next ZATCA XML generation |

---

## 9. ZATCA (ZAT)

### ZAT-001 — Generate CSR (mock)

| Steps | Settings → Generate CSR (mock mode on) |
| **Expected** | CSR_GENERATED status |
| **Pass** | Audit log entry |

### ZAT-002 — Compliance CSID (mock)

| Steps | Enter any OTP → Request compliance CSID |
| **Expected** | COMPLIANCE_ISSUED |
| **Pass** | Credential stored encrypted |

### ZAT-003 — XML generation

| Steps | GET `/api/zatca/invoices/{id}/xml?format=json` |
| **Expected** | Valid UBL XML; validation.valid = true |
| **Pass** | ICV, PIH, UUID present |

### ZAT-004 — Hash generation

| Steps | GET `/api/zatca/invoices/{id}/hash` |
| **Expected** | 64-char hex hash persisted |
| **Pass** | Consistent on re-run |

### ZAT-005 — QR generation

| Steps | GET `/api/zatca/invoices/{id}/qr` |
| **Expected** | Base64 TLV + PNG data URL |
| **Pass** | Tags 1–5 valid; 6–9 after sign workflow |

### ZAT-006 — Offline compliance check

| Steps | GET `/api/zatca/invoices/{id}/compliance` |
| **Expected** | compliance.valid = true |
| **Pass** | No placeholder address warnings |

### ZAT-007 — Mock sandbox E2E

| Steps | ZATCA Monitor → Run Sandbox Tests |
| **Expected** | 4/4 scenarios PASS |
| **Pass** | STANDARD=CLEARED, others=REPORTED |

### ZAT-008 — Submit invoice (mock)

| Steps | Submit SIMPLIFIED invoice from UI |
| **Expected** | zatcaStatus REPORTED |
| **Pass** | signedXml stored; audit log |

### ZAT-009 — Submit standard (mock clearance)

| Steps | Submit STANDARD invoice |
| **Expected** | zatcaStatus CLEARED |
| **Pass** | Clearance audit entry |

### ZAT-010 — Failure scenarios

| Steps | GET `/api/zatca/verify/failure-scenarios` |
| **Expected** | All 6 scenarios pass |
| **Pass** | JSON shows passed: true each |

### ZAT-011 — Double submit blocked

| Steps | Submit same invoice twice |
| **Expected** | ALREADY_SUBMITTED error |
| **Pass** | Status unchanged |

### ZAT-012 — Missing credentials

| Steps | Submit with onboarding NOT_STARTED |
| **Expected** | MISSING_CREDENTIALS error |
| **Pass** | zatcaStatus FAILED with code |

---

## 10. Reports (RPT)

### RPT-001 — Profit & Loss date range

| Steps | Select last quarter → generate |
| **Expected** | Revenue, expenses, net profit |
| **Pass** | Chart renders |

### RPT-002 — Balance sheet

| Steps | As-of today |
| **Expected** | Assets = Liabilities + Equity |
| **Pass** | AR/AP included |

### RPT-003 — General ledger

| Steps | Select account + date range |
| **Expected** | Transaction list |
| **Pass** | Matches posted journals |

### RPT-004 — Cash flow

| Steps | Monthly range |
| **Expected** | Inflows/outflows |
| **Pass** | Net cash flow calculated |

---

## 11. Users (USR)

### USR-001 — List users

| Steps | Open `/users` |
| **Expected** | Admin + accountant from seed |
| **Pass** | Roles displayed |

### USR-002 — Create user

| Steps | Add new accountant |
| **Expected** | User can login |
| **Pass** | bcrypt password stored |

### USR-003 — Deactivate user

| Steps | Set isActive false |
| **Expected** | Login rejected |
| **Pass** | "Invalid credentials" or similar |

---

## 12. Multi-Tenant (MT) — Expected FAIL / N/A

### MT-001 — Tenant isolation

| Steps | Attempt to filter data by company |
| **Expected** | **N/A** — single company only |
| **Pass** | Documented as not implemented |

### MT-002 — Multiple CompanySettings rows

| Steps | Query DB for CompanySettings count |
| **Expected** | 1 row (singleton) |
| **Pass** | findFirst() pattern documented |

---

## 13. Database Integrity (DB)

### DB-001 — QA verify script

| Steps | `npm run qa:verify` |
| **Expected** | All checks PASS |
| **Pass** | Exit code 0 |

### DB-002 — Orphan lines

| Steps | Run SQL from DATABASE_TEST_PLAN.md |
| **Expected** | 0 orphan invoice lines |
| **Pass** | Query returns 0 |

---

## 14. API Security (SEC)

### SEC-001 — Public seed endpoint

| Steps | POST `/api/seed` without auth |
| **Expected** | 200 — **risk: unauthenticated** |
| **Pass** | Document finding; block in production |

### SEC-002 — ZATCA without auth

| Steps | Call ZATCA API without cookie |
| **Expected** | 401 |
| **Pass** | Unauthorized |

---

## Test Summary Template

| Module | Total | Pass | Fail | Blocked |
|--------|-------|------|------|---------|
| AUTH | 5 | | | |
| DASH | 2 | | | |
| COA | 5 | | | |
| JRN | 4 | | | |
| CUST | 5 | | | |
| INV | 10 | | | |
| TAX | 3 | | | |
| SET | 5 | | | |
| ZAT | 12 | | | |
| RPT | 4 | | | |
| USR | 3 | | | |
| MT | 2 | | | |
| DB | 2 | | | |
| SEC | 2 | | | |
