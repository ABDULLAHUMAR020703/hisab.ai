# Database Test Plan — hisab.ai

**Database:** SQLite (`prisma/dev.db`) in development; PostgreSQL in production  
**ORM:** Prisma 7 with driver adapters

---

## 1. Automated Integrity Checks

Run before and after each test cycle:

```powershell
npm run qa:verify
```

Checks performed:
- Unique `customerNo`, `invoiceNo`
- Invoice subtotal vs line sum (±0.02 tolerance)
- No orphan invoice lines
- No overpaid invoices
- ZATCA tables accessible
- CompanySettings exists
- Users seeded

---

## 2. Foreign Key & Cascade Tests

### Cascades (child deleted with parent)

| Parent | Child | Test |
|--------|-------|------|
| Invoice | InvoiceLine | Delete invoice → lines gone |
| Bill | BillLine | Delete bill → lines gone |
| JournalEntry | JournalLine | Delete entry → lines gone |
| Expense | ExpenseLine | Delete expense → lines gone |
| PayrollEntry | PayrollLine | Delete payroll → lines gone |
| User | AppSession | Delete user → sessions gone |

**SQL verify (SQLite):**

```sql
-- After deleting invoice INV-00001, no orphan lines
SELECT COUNT(*) FROM InvoiceLine il
LEFT JOIN Invoice i ON il.invoiceId = i.id
WHERE i.id IS NULL;
-- Expected: 0
```

### Restrict (delete blocked)

| Parent | Child | Test |
|--------|-------|------|
| Customer | Invoice | Delete customer with invoices → fail |
| Vendor | Bill | Delete vendor with bills → fail |
| User | Invoice (createdBy) | Delete user with invoices → fail |
| ChartOfAccount | JournalLine | Delete account in use → fail |

**Manual test:** Attempt delete via API → expect 500 or Prisma FK error.

---

## 3. Duplicate Prevention

| Field | Model | Test |
|-------|-------|------|
| `email` | User | Create duplicate email → fail |
| `accountNo` | ChartOfAccount | Duplicate → fail |
| `invoiceNo` | Invoice | Sequence prevents duplicates |
| `customerNo` | Customer | Sequence prevents duplicates |
| `token` | AppSession | Unique session tokens |
| `environment` | ZatcaCredential | One row per SANDBOX/PRODUCTION |

```sql
SELECT email, COUNT(*) FROM User GROUP BY email HAVING COUNT(*) > 1;
SELECT invoiceNo, COUNT(*) FROM Invoice GROUP BY invoiceNo HAVING COUNT(*) > 1;
SELECT accountNo, COUNT(*) FROM ChartOfAccount GROUP BY accountNo HAVING COUNT(*) > 1;
```

---

## 4. Financial Data Consistency

### Invoice totals

```sql
SELECT id, invoiceNo, subtotal, taxAmount, total,
       (subtotal + taxAmount) AS calc_total
FROM Invoice
WHERE ABS(total - (subtotal + taxAmount)) > 0.02;
-- Expected: 0 rows
```

### Invoice balance

```sql
SELECT id, invoiceNo, total, amountPaid, balance,
       (total - amountPaid) AS calc_balance
FROM Invoice
WHERE ABS(balance - (total - amountPaid)) > 0.02;
-- Expected: 0 rows
```

### Line amounts

```sql
SELECT il.id, il.quantity, il.unitPrice, il.amount,
       (il.quantity * il.unitPrice) AS calc_amount
FROM InvoiceLine il
WHERE ABS(il.amount - (il.quantity * il.unitPrice)) > 0.02;
-- Expected: 0 rows
```

### Journal balance

```sql
SELECT journalId,
       SUM(debit) AS total_debit,
       SUM(credit) AS total_credit
FROM JournalLine
GROUP BY journalId
HAVING ABS(total_debit - total_credit) > 0.02;
-- Expected: 0 rows for POSTED entries
```

---

## 5. ZATCA Data Integrity

### Hash chain

```sql
SELECT id, invoiceNo, invoiceHash, previousInvoiceHash, zatcaStatus
FROM Invoice
WHERE zatcaStatus NOT IN ('DRAFT')
ORDER BY createdAt;
```

Verify: submitted invoices have non-null `invoiceHash`.

### Credential encryption

```sql
SELECT environment, onboardingStatus,
       CASE WHEN privateKeyEnc IS NOT NULL THEN 'encrypted' ELSE 'missing' END AS key_status,
       CASE WHEN secretEnc IS NOT NULL THEN 'encrypted' ELSE 'missing' END AS secret_status
FROM ZatcaCredential;
```

**Never** store plaintext private keys in `certificate` field only — keys must be in `privateKeyEnc`.

### Audit log completeness

After ZATCA submit:

```sql
SELECT action, result, COUNT(*) FROM ZatcaAuditLog
GROUP BY action, result
ORDER BY action;
```

Expected actions: `INVOICE_SUBMITTED`, `INVOICE_CLEARED` or `INVOICE_REPORTED`.

---

## 6. Sequence Integrity

```sql
SELECT type, prefix, nextNo FROM Sequence ORDER BY type;
```

After creating 100 QA invoices, `INVOICE.nextNo` should have incremented.

**Test:** Create invoice via API twice — `invoiceNo` values must differ.

---

## 7. Singleton CompanySettings

```sql
SELECT COUNT(*) AS settings_count FROM CompanySettings;
-- Expected: 1 (or document if >1 after manual testing)
```

App uses `findFirst()` — multiple rows cause undefined behavior.

---

## 8. Multi-Tenant Verification (Negative Test)

```sql
-- Confirm no tenantId column exists
PRAGMA table_info(Invoice);
-- Should NOT contain tenantId or companyId
```

**Expected:** No tenant isolation — all users see all data.

---

## 9. Seed Data Verification

After `npm run qa:seed`:

```sql
SELECT COUNT(*) FROM Customer WHERE email LIKE '%@qa.hisab.ai';        -- 50
SELECT COUNT(*) FROM InventoryItem WHERE description LIKE '%QA-SEED%'; -- 100
SELECT COUNT(*) FROM Invoice WHERE notes LIKE '%QA-SEED%';             -- 100
SELECT COUNT(*) FROM Vendor WHERE email LIKE '%@qa.hisab.ai';          -- 10
```

---

## 10. PostgreSQL-Specific (Staging/Production)

When `DATABASE_URL` starts with `postgresql://`:

```sql
-- Connection test
SELECT current_database(), current_user;

-- Table counts
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

-- FK constraints
SELECT conname, conrelid::regclass, confrelid::regclass
FROM pg_constraint
WHERE contype = 'f';
```

Apply schema via `supabase/hisab_ai_supabase.sql` or Prisma migrate — **do not mix SQLite migrations directly**.

---

## 11. Test Procedure

| Step | Action | Pass criteria |
|------|--------|---------------|
| 1 | `npm run db:seed` | No errors |
| 2 | `npm run qa:seed` | 50/100/100 counts |
| 3 | `npm run qa:verify` | All PASS |
| 4 | Run manual invoice + payment tests | SQL balance queries = 0 rows |
| 5 | Run ZATCA sandbox | Audit logs created |
| 6 | Re-run `qa:verify` | Still PASS |

---

## 12. Rollback / Reset

```powershell
# Full reset (destructive)
Remove-Item prisma/dev.db -ErrorAction SilentlyContinue
npm run db:push
npm run db:seed
npm run qa:seed
```

Backup before production testing:

```bash
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```
