# Enterprise Multi-Currency & Tax Engine — Implementation Report

Date: 2026-07-13  
Scope: Multi-currency accounting and tax engine upgrade. **VAT/ZATCA preserved.**

---

## 1. Summary

hisab.ai now supports enterprise multi-currency accounting with base/transaction/reporting currencies, FX gain/loss posting, and a currency revaluation wizard. The tax engine supports tax groups, compound/inclusive/exclusive taxes, reverse charge, withholding, exemptions, regional rules, validation, and automatic tax journal entries — while preserving existing 15% Saudi VAT behavior.

---

## 2. Database Changes

### Migration: `supabase/migrations/033_enterprise_multicurrency_tax.sql`

| Area | Changes |
|------|---------|
| **Currency roles** | `companies.reporting_currency`, `company_currencies.is_reporting` |
| **Exchange rates** | `source`, `is_manual_override`, `notes`, `created_by_id` |
| **Currency settings** | `currency_settings` — FX gain/loss account mapping |
| **Documents** | `exchange_rate`, `base_*` on invoices/bills/payments |
| **Ledger** | `base_currency`, `base_debit/credit`, `exchange_rate`, `reporting_*` |
| **Revaluation** | `fx_revaluations`, `fx_revaluation_lines` |
| **Tax groups** | `tax_groups`, `tax_group_rates` |
| **Tax rates** | `tax_mode`, `is_reverse_charge`, `is_withholding`, `region_code`, `tax_group_id`, `gl_account_id` |
| **Exemptions** | `tax_exemptions` |
| **Regional rules** | `regional_tax_rules` |
| **COA seed** | Realized/Unrealized FX gain/loss accounts (41-4103/4104, 61-6104/6105) |

---

## 3. Multi-Currency Accounting

| Feature | Implementation |
|---------|----------------|
| Base currency | Company primary currency via `getCurrencyRoles()` |
| Transaction currency | Document `currency` field (unchanged) |
| Reporting currency | `companies.reporting_currency` + `company_currencies.is_reporting` |
| Exchange rate history | Date-ordered `exchange_rates` with source tracking |
| Automatic lookup | `lookupExchangeRate()` with optional auto-fetch |
| Manual override | `is_manual_override` flag; override rates prioritized |
| FX accounts | `currency_settings` + COA accounts 41-4103/4104, 61-6104/6105 |
| Unrealized FX | Currency revaluation wizard posts UNREALIZED_FX entries |
| Realized FX | Payment settlement compares invoice vs payment rates |
| Revaluation wizard | UI: `/currency/revaluation`, API: `/api/currency/revaluation` |
| Multi-currency AR/AP | Invoice/bill posting stores `exchange_rate` + `base_*` amounts |
| Multi-currency banking | Payment posting with FX conversion on bank lines |

**Key files:** `src/lib/currency/fx-conversion.ts`, `fx-accounts.ts`, `exchange-rates.ts`, `revaluation.ts`

---

## 4. Tax Engine

| Feature | Implementation |
|---------|----------------|
| Tax groups | `tax_groups` + `tax_group_rates`; API `/api/tax/groups` |
| Compound taxes | `ADDITIVE` and `COMPOUND` methods in `calculator.ts` |
| Inclusive taxes | `tax_mode: INCLUSIVE` with `splitInclusiveAmount()` |
| Exclusive taxes | Default mode; legacy 15% VAT unchanged |
| Reverse charge | `is_reverse_charge` → DR VAT Receivable / CR VAT Payable |
| Withholding tax | `is_withholding` → withholding payable account |
| Tax exemptions | `tax_exemptions` table; API `/api/tax/exemptions` |
| Regional rules | `regional_tax_rules`; Saudi SA/INVOICE default seeded |
| Tax validation | `TaxValidationError` in `engine.ts` |
| Auto tax journals | `buildTaxJournalLines()` in `journal-posting.ts` |
| Tax calculate API | `POST /api/tax/calculate` |

**Backward compatibility:** `computeLegacyLineTax()` and `processSalesLines()` preserve existing exclusive % math. ZATCA submission unchanged.

---

## 5. API Endpoints (additive)

| Method | Path | Purpose |
|--------|------|---------|
| GET/PATCH | `/api/currency/settings` | FX account mapping |
| GET/POST | `/api/currency/revaluation` | Preview / run revaluation |
| GET/POST | `/api/exchange-rates` | Extended with lookup, override, history |
| GET/POST | `/api/tax/groups` | Tax group CRUD |
| POST | `/api/tax/calculate` | Document tax calculation |
| GET/POST | `/api/tax/exemptions` | Exemption management |

---

## 6. Tests

```bash
npm run test:accounting
```

Includes `tests/currency/multicurrency-tax.test.ts` — FX conversion, realized/unrealized math, exclusive/inclusive/compound tax.

---

## 7. Backwards Compatibility

| Area | Status |
|------|--------|
| Existing VAT 15% line math | Preserved via `computeLegacyLineTax()` |
| ZATCA e-invoicing | Untouched |
| Document APIs | Same request/response shapes |
| Ledger `debit`/`credit` | Still transaction currency; `base_*` added |
| Migrations 001–032 | Untouched |

---

## 8. Deployment Checklist

1. Apply migration `033_enterprise_multicurrency_tax.sql`
2. Run `npm run test:accounting`
3. Configure exchange rates for foreign currencies
4. Verify currency settings FX account mapping
5. Test revaluation wizard preview + post
6. Test foreign currency invoice → payment → realized FX
