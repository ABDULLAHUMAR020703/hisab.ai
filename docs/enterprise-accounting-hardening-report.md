# Enterprise Accounting Hardening — Implementation Report

Date: 2026-07-13  
Scope: Accounting integrity, audit, validation, performance, and tests. No module rewrites; backwards-compatible extensions only.

---

## 1. Summary

The accounting engine was upgraded from functional double-entry to **enterprise-grade immutable posting** with:

- Monotonic posting sequences
- Reversing, adjusting, and cloning journal operations
- Fiscal year close with retained earnings and opening balance generation
- Immutable posting audit trail (before/after, user, reason, IP)
- Comprehensive pre-posting validation
- Performance indexes, pagination, and report caching
- Automated enterprise test suite

**Existing public APIs preserved.** New endpoints added additively.

---

## 2. Database Changes

### Migration: `supabase/migrations/032_enterprise_accounting_hardening.sql`

| Change | Purpose |
|--------|---------|
| `journal_entry_type` enum | STANDARD, REVERSING, ADJUSTING, CLOSING, OPENING |
| `journal_entries` columns | `entry_type`, `source_journal_id`, `reversed_by_journal_id`, `posting_sequence`, `post_reason`, `currency` |
| `ledger_entries` columns | `posting_sequence`, `reversal_of_ledger_id`, `branch_id` |
| `audit_logs` columns | `before_state`, `after_state`, `reason`, `ip_address`, `branch_id` |
| `posting_sequences` table | Atomic monotonic sequence per company |
| `fiscal_year_closings` table | Year-close audit record with closing/opening journal links |
| New indexes | Ledger source/date, posting sequence, audit entity/action |
| `next_posting_sequence()` | Atomic sequence allocator |
| `prevent_account_delete_with_ledger` trigger | Blocks deleting accounts with posted transactions |
| Enhanced `post_journal_entry()` | Validation, duplicate guard, sequence assignment, account active check |

**Ledger source types added:** `REVERSAL`, `YEAR_CLOSE`

---

## 3. Accounting Integrity

### Immutable posting
- Posted journals cannot be edited or deleted (existing API behaviour preserved)
- `post_journal_entry()` rejects duplicate ledger rows for the same journal
- Only **reversing journals** modify the effect of posted transactions

### New journal operations (`src/lib/accounting/journal-operations.ts`)

| Operation | API | Behaviour |
|-----------|-----|-----------|
| **Reverse** | `POST /api/journal/[id]/reverse` | Creates REVERSING entry with swapped debits/credits, auto-posts, links `reversed_by_journal_id` |
| **Adjust** | `POST /api/journal/[id]/adjust` | Creates ADJUSTING entry linked to source, optional auto-post |
| **Clone** | `POST /api/journal/[id]/clone` | Copies lines to new DRAFT STANDARD entry |

### Fiscal year close (`src/lib/accounting/year-close.ts`)

| Step | Action |
|------|--------|
| 1 | Close income/expense/COGS accounts to Retained Earnings (CLOSING journal) |
| 2 | Close fiscal period |
| 3 | Create next-year fiscal period |
| 4 | Generate OPENING balance journal from Asset/Liability/Equity balances |
| 5 | Record in `fiscal_year_closings` |

**API:** `POST /api/fiscal-periods/close-year` with `{ periodId, reason? }`

### Posting sequence
- Every post assigns `posting_sequence` via `next_posting_sequence()`
- Returned in `POST /api/journal/[id]/post` response as `postingSequence`

---

## 4. Audit

### Enhanced audit (`src/lib/accounting/posting-audit.ts`)

Every posting operation writes to `audit_logs` with:

| Field | Recorded |
|-------|----------|
| `before_state` | JSON snapshot before post |
| `after_state` | JSON snapshot after post (status, sequence) |
| `user_id` | Authenticated user |
| `created_at` | Timestamp |
| `reason` | Post/reversal/close reason |
| `ip_address` | From `x-forwarded-for` / `x-real-ip` |
| `entity_type` / `entity_id` | Journal, document, fiscal period |
| `company_id` | Tenant isolation |
| `branch_id` | Reserved for future branch support |

**Actions logged:** `JOURNAL_POSTED`, `JOURNAL_REVERSED`, `JOURNAL_ADJUSTED`, `DOCUMENT_POSTED`, `FISCAL_YEAR_CLOSED`

---

## 5. Validation

### Pre-posting validation (`src/lib/accounting/validation.ts`)

| Rule | Error code |
|------|------------|
| Debit == Credit | `UNBALANCED` |
| Non-zero amounts | `ZERO_AMOUNT` |
| Account active & exists | `ACCOUNT_INACTIVE`, `ACCOUNT_NOT_FOUND` |
| Fiscal period open | `PERIOD_CLOSED` |
| Currency configured | `CURRENCY_INVALID` |
| Exchange rate exists | `EXCHANGE_RATE_MISSING` |
| Cost center / project valid | `COST_CENTER_INVALID` |
| Department valid | `DEPARTMENT_INVALID` |
| Tax rate valid | `TAX_RATE_INVALID` |
| No duplicate posting | `DUPLICATE_POSTING` |
| Account deletable (no ledger rows) | `ACCOUNT_HAS_TRANSACTIONS` |

### Account delete protection
- App layer: `src/app/api/accounts/[id]/route.ts` calls `validateAccountDeletable()` + soft-delete via repository
- DB layer: trigger `chart_of_accounts_prevent_delete_with_ledger`

---

## 6. Performance

| Optimization | Location |
|--------------|----------|
| Indexes on `posting_sequence`, source+date | Migration 032 |
| Ledger query ordering by `posting_sequence` | `src/lib/accounting/ledger.ts` |
| General ledger pagination (`limit`, `offset`, `count`) | `GET /api/reports/general-ledger` |
| Report caching (60s TTL) | `src/lib/accounting/report-cache.ts`, trial balance route |
| Batch account validation (single query) | `validation.ts` |

---

## 7. New API Endpoints (additive)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/journal/[id]/reverse` | Reverse posted journal |
| POST | `/api/journal/[id]/adjust` | Create adjusting entry |
| POST | `/api/journal/[id]/clone` | Clone journal to draft |
| POST | `/api/fiscal-periods/close-year` | Close fiscal year |

### Modified (backwards-compatible)

| Endpoint | Change |
|----------|--------|
| `POST /api/journal/[id]/post` | Returns `postingSequence`; validation + audit |
| `DELETE /api/accounts/[id]` | Blocks if ledger transactions exist |
| `GET /api/reports/general-ledger` | Supports `limit`/`offset` pagination |
| `GET /api/reports/trial-balance` | Report caching |

---

## 8. Tests

### Suite: `tests/accounting/enterprise.test.ts` (18 tests)

Covers posting validation, normal balance, trial balance integrity, report caching, reversal logic, duplicate posting detection, year close math, balance sheet equation, P&L math, cash flow math, adjusting entry rules, opening balance rules, and locked period rules.

Run: `npm run test:accounting` (22 total tests including engine suite)

---

## 9. Backwards Compatibility

| Area | Status |
|------|--------|
| Existing journal CRUD APIs | Unchanged behaviour |
| `post_journal_entry` RPC name | Preserved (signature extended to return BIGINT) |
| Document posting | Enhanced with validation + audit; same interface |
| Existing migrations 025–031 | Untouched |
| Existing data | Preserved; new columns nullable/defaulted |
| Report response shapes | Extended with `pagination` on GL only |

---

## 10. Deployment Checklist

1. Apply migration `032_enterprise_accounting_hardening.sql`
2. Run `npm run test:accounting`
3. Smoke test: post, duplicate post block, reverse, year close, account delete guard
