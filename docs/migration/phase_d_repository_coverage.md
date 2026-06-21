# Phase D — Repository Coverage Report (D2)

**Date:** 2025-06-21  
**Location:** `src/lib/db/`

## Implemented repositories

| Module | File | Methods | Status |
| ------ | ---- | ------- | ------ |
| Company | `company.repository.ts` | `findCompanyById`, `findCompanyBySlug`, `getDefaultCompanyId`, `listCompanies`, `createCompany` | Complete for tenant shell |
| Settings | `settings.repository.ts` + `repositories/settings.*` | `findFirst`, `create`, `update`, `upsert` | **Wired via provider (D3/D4)** |
| User / profile | `user.repository.ts` | `findProfileByUserId`, `findProfileByLegacyUserId`, `upsertProfile`, `listCompanyUsers`, `listUserCompanies`, `addCompanyUser`, preferences | Partial — no legacy `User` CRUD |
| ZATCA | `zatca.repository.ts` | `getCredential`, `upsertCredential`, onboarding request CRUD | Complete for onboarding store |

## Provider layer (D3)

| File | Purpose |
| ---- | ------- |
| `provider.ts` | `getSettingsRepository()` — routes use this |
| `parity.ts` | Shadow-read comparison when `DB_PARITY_CHECK=true` |
| `repositories/settings.interface.ts` | Shared contract |
| `repositories/settings.prisma.ts` | Prisma adapter |
| `repositories/settings.supabase.ts` | Supabase adapter |

---

## Entity coverage matrix

| Entity | Prisma Methods Used in App | Supabase Methods | Missing |
| ------ | -------------------------- | ---------------- | ------- |
| **CompanySettings** | `findFirst`, `create`, `update` | `findFirstCompanySettings`, `createCompanySettings`, `updateCompanySettings`, `upsertCompanySettings` | None — **provider wired** |
| **Company** | (implicit via settings) | `findCompanyById`, `getDefaultCompanyId`, `createCompany` | `updateCompany` |
| **User** | `findFirst`, `findUnique`, `findMany`, `create`, `update`, `delete`, `count` | Profile/company_users only | Full user CRUD, password hash, role mapping |
| **AppSession** | `findUnique`, `create`, `deleteMany` | — | Entire module (D11 Auth) |
| **Customer** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods + invoice balance join |
| **Vendor** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods |
| **ChartOfAccount** | `findMany`, `findUnique`, `findFirst`, `create`, `update`, `delete`, `count` | — | All methods |
| **CostCenter** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods |
| **JournalEntry** | `findMany`, `findUnique`, `create`, `update`, `groupBy` | — | All + post workflow + balancing |
| **JournalLine** | nested create/delete | — | All methods |
| **Invoice** | `findMany`, `findUnique`, `create`, `update`, `delete`, `aggregate`, `groupBy`, `count` | — | All + ZATCA field reads |
| **InvoiceLine** | nested create/delete | — | All methods |
| **Bill** | `findMany`, `findUnique`, `create`, `update`, `delete`, `aggregate`, `groupBy` | — | All methods |
| **BillLine** | nested create/delete | — | All methods |
| **Expense** | `findMany`, `findUnique`, `create`, `update`, `delete`, `aggregate`, `groupBy` | — | All methods |
| **ExpenseLine** | nested create/delete | — | All methods |
| **Payment** | `create`, `findMany`, `count` | — | All methods |
| **Employee** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods |
| **PayrollEntry** | `findMany`, `findUnique`, `create`, `update`, `aggregate`, `count` | — | All + approve workflow |
| **PayrollLine** | nested create | — | All methods |
| **InventoryItem** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods |
| **TaxRate** | `findMany`, `findFirst`, `create` | — | All methods |
| **Receipt** | `findMany`, `findUnique`, `create`, `update`, `delete`, `count` | — | All methods |
| **Sequence** | `findUnique`, `create`, `update` | — | All methods (used by `sequences.ts`) |
| **ZatcaCredential** | `findUnique`, `upsert` | `getCredential`, `upsertCredential` | Wire through provider (D10) |
| **ZatcaOnboardingRequest** | (via service) | `create`, `update`, `findLatest` | Wire through provider (D10) |
| **ZatcaAuditLog** | `create`, `findMany` | — | All methods |
| **ZatcaSandboxTestRun** | `create`, `update` | — | All methods |

---

## Recommended build order

1. **D4 reads:** `customer`, `vendor`, `chartOfAccount`, `invoice` (+ lines), `zatcaAuditLog`, dashboard aggregator
2. **D5 writes:** customer, vendor, invoice, payment, expense (dual-write)
3. **D6:** journal, cost center, tax, receipt, sequence
4. **D7:** inventory
5. **D8:** payroll, employee
6. **D9–D10:** ZATCA (after invoice + credential repos wired)
7. **D11:** auth (plan only until repos stable)

---

## Rollback

Repositories are additive. Prisma adapters remain the default until `USE_SUPABASE=true`.
