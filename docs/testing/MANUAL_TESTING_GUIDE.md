# Manual Testing Guide — hisab.ai

**Audience:** Non-technical QA testers  
**Prerequisites:** Node 22+, app running at `http://localhost:3000`  
**Time estimate:** Full pass ~8–12 hours; smoke test ~2 hours

---

## Before You Start

### 1. Set up the environment

```powershell
cd financebook
npm install
npm run db:seed
npm run qa:seed
npm run dev
```

Open **http://localhost:3000**

### 2. Logins

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@hisab.ai` | `admin123` |
| Accountant | `accountant@hisab.ai` | `accountant123` |

### 3. What to record

For each test, note: **PASS / FAIL**, screenshot if FAIL, browser (Chrome/Edge), date.

---

## Recommended Test Order

Do tests in this order — highest risk first:

1. Login & logout (Section A)
2. Database check: `npm run qa:verify` (Section B)
3. Invoices & payments (Section E) — **money calculations**
4. ZATCA mock tests (Section H) — **compliance**
5. Settings & company profile (Section G)
6. Customers & vendors (Section D)
7. Reports (Section F)
8. Everything else

---

## Section A — Login & Navigation

### A1. Login as admin

1. Open `http://localhost:3000/login`
2. Email: `admin@hisab.ai`
3. Password: `admin123`
4. Click **Sign In**

**Expected:** Dashboard opens. Left sidebar shows: Dashboard, Chart of Accounts, Invoices, etc.

**If it fails:** Check terminal for errors. Try `npm run db:seed`.

### A2. Logout

1. Top-right user icon → **Sign out**

**Expected:** Login page appears.

### A3. Protected page without login

1. While logged out, go to `http://localhost:3000/invoices`

**Expected:** Redirect to `/login`.

### A4. Mobile sidebar

1. Resize browser to phone width (< 768px)
2. Click hamburger menu (☰)

**Expected:** Sidebar slides in; links work.

---

## Section B — Database Quick Check

In terminal (keep app running in another window):

```powershell
npm run qa:verify
```

**Expected:** All lines show `PASS`. Final line: `X/X checks passed`.

---

## Section C — Dashboard

1. Login → Dashboard (`/`)
2. Check cards: Revenue, Expenses, Accounts Receivable, Accounts Payable
3. Scroll to charts and Recent Activity

**Expected:** Numbers appear (not blank). Charts render.

**Edge case:** Refresh page — data should remain.

---

## Section D — Customers

### D1. View QA customers

1. Sidebar → **Customers**
2. Search: `qa.hisab`

**Expected:** ~50 customers from QA seed (emails like `customer1@qa.hisab.ai`).

### D2. Create a new customer

1. Click **Add Customer** (or equivalent button)
2. Fill:
   - Name: `Test Customer Manual`
   - Email: `manual-test@example.com`
   - VAT TRN: `300000000000003`
   - City: `Riyadh`
   - Building Number: `1234`
   - District: `Al Olaya`
   - Postal Code: `12211`
3. Save

**Expected:** Customer appears in list. Search finds it.

### D3. Edit customer

1. Open the customer you created
2. Change phone number
3. Save

**Expected:** New phone shows after refresh.

---

## Section E — Invoices (Critical)

### E1. Create a simple invoice

1. Sidebar → **Invoices** → **New Invoice**
2. Select customer: any QA customer with VAT
3. Date: today
4. Due date: 30 days from now
5. Add line:
   - Description: `Consulting services`
   - Quantity: `10`
   - Unit price: `1000`
   - VAT: `15%`
6. Save

**Expected:**
- Subtotal: `10,000.00`
- VAT: `1,500.00`
- Total: `11,500.00`
- Balance: `11,500.00`

**If math is wrong:** FAIL — record exact numbers shown.

### E2. Record payment

1. Open the invoice from E1
2. Click **Record Payment** (or Pay)
3. Amount: full total `11,500.00`
4. Method: Bank Transfer
5. Save

**Expected:** Balance = 0. Status shows Paid.

### E3. Invoice types

Create one invoice of each type (if UI supports type selection):

| Type | When to use |
|------|-------------|
| STANDARD | B2B tax invoice |
| SIMPLIFIED | B2C / retail |
| CREDIT_NOTE | Refund / correction down |
| DEBIT_NOTE | Additional charge |

**Expected:** Each saves with correct type label.

### E4. Search invoices

1. Search bar: type `INV-`
2. Search customer name

**Expected:** List filters correctly.

### E5. Overdue invoice

1. Find a QA invoice with OVERDUE status (from seed)
2. Verify due date is in the past

**Expected:** Status badge shows overdue.

---

## Section F — Reports

### F1. Profit & Loss

1. Sidebar → **Reports** → **Profit & Loss**
2. Set date range: first day of year → today
3. Generate

**Expected:** Revenue and expense sections with totals. Chart displays.

### F2. Balance Sheet

1. Reports → **Balance Sheet**
2. Date: today

**Expected:** Assets, Liabilities, Equity sections.

### F3. General Ledger

1. Reports → **General Ledger**
2. Select account (e.g. revenue account)
3. Date range: last 3 months

**Expected:** List of journal lines or empty if none posted.

---

## Section G — Settings & Company Profile

### G1. Update company details

1. Sidebar → **Settings**
2. Update:
   - Legal Name: `QA Test Company LLC`
   - VAT TRN: `300000000000003`
   - Street: `King Fahd Road`
   - Building: `4521`
   - District: `Al Olaya`
   - City: `Riyadh`
   - Postal: `12211`
3. Save

**Expected:** Success message. Values persist after refresh.

### G2. Test alternate company profile

1. Open file `data/qa-company-profiles.json` in project folder
2. Copy **retail** profile fields into Settings form
3. Save

**Expected:** Company name changes to "Riyadh Retail Group".

> **Note:** App supports one company at a time. "3 companies" = 3 profiles you switch manually.

### G3. Enable ZATCA

1. Settings → Enable ZATCA toggle ON
2. Environment: **SANDBOX**
3. Save

**Expected:** ZATCA onboarding section appears below.

---

## Section H — ZATCA (Mock Mode)

**Ensure mock mode** (for local testing):

```powershell
# In .env or terminal before npm run dev:
ZATCA_MOCK_ONBOARDING=true
ZATCA_MOCK_SUBMISSION=true
```

### H1. Generate CSR

1. Settings → ZATCA section → **Generate CSR**
2. Wait for completion

**Expected:** Status shows CSR generated. No error.

### H2. Compliance CSID (mock)

1. Enter OTP: `123456` (any value in mock mode)
2. Click **Request Compliance CSID**

**Expected:** Compliance CSID issued. Status updates.

### H3. ZATCA Monitor

1. Sidebar → **ZATCA Monitor** (`/zatca`)
2. Review stats cards and audit log

**Expected:** Page loads. May show zeros if no submissions yet.

### H4. Run sandbox tests

1. On ZATCA Monitor page → **Run Sandbox Tests**
2. Wait 30–60 seconds

**Expected:** 4/4 scenarios PASS:
- STANDARD → CLEARED
- SIMPLIFIED → REPORTED
- CREDIT_NOTE → REPORTED
- DEBIT_NOTE → REPORTED

**If any FAIL:** Copy error from UI and report.

### H5. Submit real invoice (mock)

1. Go to **Invoices**
2. Pick a SIMPLIFIED QA invoice (not yet submitted)
3. Click **Submit to ZATCA** (or ZATCA action button)
4. Confirm

**Expected:** Status changes to REPORTED. No error toast.

### H6. Submit standard invoice (mock clearance)

1. Pick a STANDARD invoice
2. Submit to ZATCA

**Expected:** Status CLEARED.

### H7. Double submit (error test)

1. Try submitting the same invoice again

**Expected:** Error: already submitted. Status unchanged.

---

## Section I — Other Modules (Smoke)

Quickly verify each page **loads without error**:

| # | Page | Action |
|---|------|--------|
| 1 | `/accounts` | Scroll list |
| 2 | `/journal` | Open create form |
| 3 | `/bills` | List loads |
| 4 | `/expenses` | List loads |
| 5 | `/vendors` | List loads |
| 6 | `/payroll` | List loads |
| 7 | `/employees` | List loads |
| 8 | `/inventory` | ~100 QA items visible |
| 9 | `/cost-centers` | List loads |
| 10 | `/receipts` | Page loads |
| 11 | `/tax` | VAT rates visible |
| 12 | `/users` | 2+ users listed |

---

## Section J — Error Conditions to Try

| Test | How | Expected |
|------|-----|----------|
| Empty invoice | Save with no lines | Validation error |
| Missing customer | Create invoice without customer | Blocked |
| Wrong login | Bad password 3 times | Error each time |
| Expired session | Delete cookies manually → click any page | Redirect login |
| ZATCA without onboarding | Submit with ZATCA enabled but no CSR | Credentials error |

---

## Section K — Accountant Role Test

1. Logout
2. Login as `accountant@hisab.ai` / `accountant123`
3. Repeat E1 (create invoice) and H5 (ZATCA submit)

**Expected:** Same access as admin (no role restriction currently — document if unexpected).

---

## Reporting Defects

Include:

1. Test section ID (e.g. E1)
2. Steps to reproduce
3. Expected vs actual
4. Screenshot
5. Browser + URL
6. Invoice/customer ID if applicable

---

## Smoke Test Checklist (2 hours)

- [ ] A1 Login
- [ ] B  qa:verify passes
- [ ] E1 Create invoice math
- [ ] E2 Payment
- [ ] H4 Sandbox 4/4
- [ ] H5 Submit simplified
- [ ] H6 Submit standard
- [ ] F1 P&L loads
- [ ] G1 Settings save
- [ ] I All pages load
