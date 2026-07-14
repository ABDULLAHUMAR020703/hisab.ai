# Import/Export Framework — Manual QA Checklist

Use this checklist to validate the framework in the browser before moving to document-based modules.

**Prerequisites**

- [ ] Migrations `023_import_export_framework.sql` and `024_import_jobs_user_fk_fix.sql` applied
- [ ] Dev server running (`npm run dev`)
- [ ] Logged in with a test company
- [ ] Test data available in `test-data/` (run `npm run generate:test-data` if missing)

---

## Per-module checklist

Repeat for each module: **Customers**, **Vendors**, **Inventory**, **Chart of Accounts**, **Cost Centers**, **Employees**, **Tax Rates**.

### UI consistency

- [ ] Page header shows **Import ▼**, **Export ▼**, and **+ New Record**
- [ ] Import dropdown offers **Import CSV** and **Import Excel**
- [ ] Export dropdown offers **Export CSV** and **Export Excel**
- [ ] Spacing and button styles match Customers (reference module)
- [ ] Import wizard opens and closes correctly

### Import — happy path (use `test-data/{module}/small.csv`)

- [ ] Upload CSV → headers detected
- [ ] Auto-mapping maps all required fields
- [ ] Preview shows mapped data correctly
- [ ] Validation passes with no blocking errors
- [ ] Import completes successfully
- [ ] New records appear in list
- [ ] Import appears in **Import History** (`/import-history`)

### Import — Excel (use `test-data/{module}/small.xlsx`)

- [ ] Upload XLSX → same workflow as CSV
- [ ] All rows imported correctly

### Import — medium dataset (`medium.csv`, 100 rows)

- [ ] Parse and validate completes in reasonable time (< 10s)
- [ ] Import completes without timeout
- [ ] Count in list increases by expected amount (minus duplicates)

### Mapping templates

- [ ] Save mapping template during import
- [ ] Load saved template on next import
- [ ] Manual column remap works (change one mapping, verify preview updates)
- [ ] Required field mapping validation shows error if required field unmapped

### Duplicate handling (import `small.csv` twice)

- [ ] Duplicate dialog appears before import
- [ ] **Skip Existing Records** — duplicates not created
- [ ] **Update Existing Records** — existing records updated
- [ ] **Create Duplicate Records** — new records created despite duplicates

### Validation (use `test-data/edge-cases/`)

| Fixture | Expected |
|---------|----------|
| `customers/blank-required-fields.csv` | Row 1 blocked (missing name); row 2 imports |
| `customers/wrong-data-types.csv` | Invalid email = error; invalid VAT = warning only |
| `customers/duplicate-headers.csv` | Upload rejected with duplicate header message |
| `customers/empty-file.csv` | Headers only, zero rows to import |
| `customers/special-characters-arabic.csv` | Arabic text preserved; invalid Arabic email may warn/error |
| `employees/invalid-dates.csv` | Invalid joining dates blocked |
| `inventory/negative-prices.csv` | Negative cost price blocked |
| `accounts/missing-required.csv` | Blank required fields blocked |

- [ ] Errors block invalid rows from importing
- [ ] Warnings do **not** block import
- [ ] Validation summary shows error and warning counts
- [ ] Error report downloadable for failed rows

### Export

- [ ] Export CSV downloads file with correct columns
- [ ] Export Excel downloads `.xlsx` with correct columns
- [ ] Export with **search** active exports filtered records only
- [ ] Export with **filters** active exports filtered records only (Customers: country/city/VAT/balance; Accounts: type)
- [ ] Export with no matches returns empty or minimal file (not full dataset)
- [ ] Large export (100+ records) completes without error

### Import history

- [ ] History page lists recent imports
- [ ] Detail view shows counts (imported, updated, skipped, failed)
- [ ] Error download works for imports with failures

---

## Module-specific notes

### Customers

- [ ] Export respects country, city, VAT filter, balance filter, sort
- [ ] Saudi VAT TRN warnings shown for invalid 15-digit TRN

### Vendors

- [ ] Export excludes outstanding balance column (flat vendor data only)

### Chart of Accounts

- [ ] Export respects account type filter
- [ ] `accountNo` required on import

### Employees

- [ ] `joiningDate` required; must be YYYY-MM-DD

### Tax Rates

- [ ] Tax page toolbar present alongside VAT report section
- [ ] Only one default rate allowed per company

---

## Performance smoke test (optional)

Using `test-data/customers/large.csv` (1000 rows):

| Step | Target |
|------|--------|
| Parse upload | < 5s |
| Validate | < 15s |
| Import (skip duplicates) | < 60s |
| Export CSV | < 10s |

Record actual times: _______________

---

## Sign-off

| Module | Tester | Date | Pass/Fail | Notes |
|--------|--------|------|-----------|-------|
| Customers | | | | |
| Vendors | | | | |
| Inventory | | | | |
| Chart of Accounts | | | | |
| Cost Centers | | | | |
| Employees | | | | |
| Tax Rates | | | | |

**Framework ready for document modules?** ☐ Yes ☐ No — issues: _______________
