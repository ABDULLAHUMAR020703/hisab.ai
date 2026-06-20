# Phase C — Data Migration Plan (SQLite → Supabase)

**Status:** Plan only — no migration scripts yet  
**Prerequisites:** Migrations `001`–`012` applied; seed `001_default_company.sql` run  
**Source:** `prisma/dev.db` (SQLite via Prisma)  
**Target:** Supabase PostgreSQL (`public` schema)  
**Tenant model:** Single-company cutover (all SQLite data → one `company_id`)

---

## Executive summary

The current SQLite database is a **single-tenant** deployment: one `CompanySettings` row, two `User` rows, and ~900+ business rows across accounting and ZATCA tables. Supabase expects **UUID primary keys**, **`company_id` on every business row**, and **split company/ZATCA settings**.

This plan maps every Prisma model to Supabase tables, defines ID preservation rules, migration order, validation, and rollback — without modifying application code in Phase C planning.

### Current SQLite inventory (`prisma/dev.db`)

| SQLite table | Rows | Migrate? |
|---|---:|---|
| CompanySettings | 1 | Yes → `companies` + settings split |
| User | 2 | Yes → `auth.users` + `profiles` + `company_users` |
| AppSession | 5 | **No** — replaced by Supabase Auth |
| ChartOfAccount | 83 | Yes |
| CostCenter | 5 | Yes |
| TaxRate | 4 | Yes |
| Sequence | 11 | Yes |
| Customer | 52 | Yes |
| Vendor | 12 | Yes |
| Employee | 2 | Yes |
| InventoryItem | 102 | Yes |
| JournalEntry | 1 | Yes |
| JournalLine | 2 | Yes |
| Receipt | 1 | Yes |
| Expense | 2 | Yes |
| ExpenseLine | 2 | Yes |
| Bill | 2 | Yes |
| BillLine | 2 | Yes |
| Invoice | 123 | Yes — **ZATCA-critical** |
| InvoiceLine | 123 | Yes |
| Payment | 41 | Yes |
| PayrollEntry | 1 | Yes |
| PayrollLine | 3 | Yes |
| ZatcaCredential | 2 | Yes — **encrypted secrets** |
| ZatcaOnboardingRequest | 41 | Yes |
| ZatcaAuditLog | 206 | Yes |
| ZatcaSandboxTestRun | 8 | Yes |

**ZATCA snapshot highlights:**

- `Invoice`: 123 total; 120 with `invoiceUUID`; 17 with `invoiceHash` + `signedXml`; 0 with `previousInvoiceHash` populated (PIH resolved at runtime via `created_at` ordering today)
- `ZatcaCredential`: SANDBOX (`COMPLIANCE_VALIDATED`, compliance CSID present, encrypted CSR/key/cert/secret); PRODUCTION (`FAILED`, encrypted CSR/key only)
- `CompanySettings`: ZATCA enabled/connected, SANDBOX environment, EGS identity fields populated

---

## ID preservation strategy

SQLite uses **Prisma `cuid()`** strings (e.g. `cmpdb02yx0000r0ndxozig7hv`). Supabase uses **`UUID` primary keys** plus **`legacy_id TEXT`** for traceability.

### Rules

| ID type | Preservation approach |
|---|---|
| Prisma row `id` (cuid) | Stored in **`legacy_id`** unchanged. Supabase **`id`** = deterministic UUID (see below). |
| `Invoice.invoiceUUID` | Copied verbatim to **`invoices.invoice_uuid`** (already RFC-4122 UUID strings). |
| `Invoice.invoiceHash` | Copied verbatim to **`invoices.invoice_hash`**. |
| `Invoice.previousInvoiceHash` | Copied verbatim (may be NULL; do not recompute). |
| ZATCA CSIDs / request IDs | Copied verbatim to matching columns. |
| Encrypted blobs (`*Enc` columns) | **Byte-identical copy** — same ciphertext, same `ZATCA_CREDENTIAL_ENCRYPTION_KEY` required at runtime. |
| `CompanySettings.id` | Stored in mapping table; company row uses seed UUID (see company backfill). |

### Deterministic UUID mapping (recommended)

Generate Supabase `id` deterministically so re-runs are idempotent:

```
namespace = 00000000-0000-4000-8000-000000000099  (migration namespace)
new_uuid  = UUIDv5(namespace, 'hisab:' || table_name || ':' || legacy_cuid)
```

Maintain a **`migration_id_map`** artifact (CSV/JSON) during Phase C implementation:

| legacy_table | legacy_id | supabase_table | supabase_id |
|---|---|---|---|

All foreign keys in the load script resolve through this map.

### What “preserve all existing IDs” means in practice

- **Application-visible cuid values** remain in `legacy_id` and the mapping file.
- **ZATCA business identifiers** (`invoice_uuid`, hashes, CSIDs) remain unchanged in their dedicated columns.
- **Supabase UUID `id`** is a new stable surrogate tied 1:1 to each cuid via deterministic generation (not random).

---

## Company ID backfill strategy

SQLite has **no `company_id`** — everything is implicitly scoped to the single `CompanySettings` row.

### Target tenant

Use the seeded default company from `supabase/seed/001_default_company.sql`:

```
company_id = 00000000-0000-4000-8000-000000000001  (slug: netkom)
```

### Step 1 — Upsert company root from `CompanySettings`

**Do not insert a second company.** UPDATE the seed row with SQLite `CompanySettings` values (SQLite is authoritative for production-like demo data):

| SQLite `CompanySettings` | Supabase destination |
|---|---|
| `companyName` | `companies.company_name` |
| `legalName` | `companies.legal_name` |
| `taxId` | `companies.tax_id` |
| `commercialRegistration` | `companies.commercial_registration` |
| `address`, `streetAddress`, `buildingNumber`, `district`, `city`, `postalCode`, `country` | same-named columns on `companies` |
| `phone`, `email`, `currency`, `fiscalYearStart` | same on `companies` |
| `createdAt`, `updatedAt` | `companies.created_at`, `companies.updated_at` |

Store `CompanySettings.id` → `company_id` in `migration_id_map` (legacy settings id maps to fixed seed UUID).

### Step 2 — ZATCA settings split

| SQLite field | Supabase table.column |
|---|---|
| `zatcaEnabled` | `company_zatca_settings.zatca_enabled` |
| `zatcaConnected` | `company_zatca_settings.zatca_connected` |
| `zatcaConnectedAt` | `company_zatca_settings.zatca_connected_at` |
| `zatcaEnvironment` | `company_zatca_settings.zatca_environment` |
| `zatcaEgsUnitId` | `company_zatca_settings.zatca_egs_unit_id` |
| `zatcaDeviceIdentifier` | `company_zatca_settings.zatca_device_identifier` |
| `zatcaEgsSerialNumber` | `company_zatca_settings.zatca_egs_serial_number` |
| `zatcaBusinessCategory` | `company_zatca_settings.zatca_business_category` |

### Step 3 — Backfill `company_id` on every business row

For all migrated tables (006–009), set:

```
company_id = '00000000-0000-4000-8000-000000000001'
```

Child tables (`journal_lines`, `invoice_lines`, etc.) must use the **same `company_id` as their parent** to satisfy composite FKs from migration `011`.

---

## Auth & user migration

| Prisma | Supabase | Notes |
|---|---|---|
| `User` | `auth.users` + `profiles` + `company_users` | Create Supabase Auth users for `admin@hisab.ai`, `accountant@hisab.ai` |
| `User.id` | `profiles.legacy_user_id` | Map to new `profiles.id` = `auth.users.id` |
| `User.role` | `company_users.role` | Map `ADMIN`→`ADMIN`, `ACCOUNTANT`→`ACCOUNTANT` |
| `User.password` | Supabase Auth | Re-hash via Auth API or pre-seed with known demo passwords |
| `AppSession` | — | **Skip** — sessions not migrated |

FK columns `created_by_id`, `uploaded_by_id` resolve through user ID map → `profiles.id`.

---

## Sequence migration strategy

| SQLite | Supabase |
|---|---|
| `Sequence.type` @unique globally | `UNIQUE (company_id, type)` |
| `Sequence.prefix` | `sequences.prefix` |
| `Sequence.nextNo` | `sequences.next_no` |

**Load rule:** For each SQLite `Sequence` row, INSERT into `sequences` with:

- `company_id` = default tenant UUID
- `legacy_id` = SQLite `Sequence.id`
- `type`, `prefix`, `next_no` copied directly

**Critical:** Preserve **`next_no` exactly** — do not reset to 1. Current SQLite counters include `INVOICE nextNo=224`, `CUSTOMER nextNo=103`, etc.

**Validation:** Compare `(type, prefix, next_no)` sets between SQLite and Supabase per company.

---

## Migration order (dependency graph)

Load using **`service_role`** (bypass RLS). Disable triggers only if bulk load requires it; prefer batched INSERT with correct order.

```
Phase C0  — Export SQLite → staging JSON/CSV + build migration_id_map
Phase C1  — Company upsert (companies, company_settings, company_zatca_settings)
Phase C2  — Auth users + profiles + company_users
Phase C3  — Reference data
            chart_of_accounts → cost_centers → tax_rates → sequences
Phase C4  — Party / HR / inventory
            customers → vendors → employees → inventory_items
Phase C5  — GL & expenses
            receipts → journal_entries → journal_lines
            expenses → expense_lines
Phase C6  — AP / AR documents
            bills → bill_lines
            invoices → invoice_lines   ← preserve ZATCA fields here
            payments
Phase C7  — Payroll
            payroll_entries → payroll_lines
Phase C8  — ZATCA
            zatca_credentials → zatca_onboarding_requests
            zatca_audit_logs → zatca_sandbox_test_runs
Phase C9  — Validation (012 + Phase C checks)
```

Within each phase: **parents before children**; resolve FKs via `migration_id_map`.

---

## Table-by-table mapping

### Legend

- **Transform:** `direct` | `rename` | `split` | `cast` | `json` | `map_fk` | `fixed`
- **Skip:** not migrated

---

### CompanySettings → split

| Source | Destination | Field mappings | Transform |
|---|---|---|---|
| `CompanySettings` | `companies` | See company backfill table | split + upsert seed |
| — | `company_settings` | defaults from seed; optional `invoice_prefix` from app | fixed row per company |
| ZATCA fields | `company_zatca_settings` | See ZATCA split table | split |

---

### User → auth + profiles + company_users

| Prisma field | Supabase column | Transform |
|---|---|---|
| `id` | `profiles.legacy_user_id` | direct |
| `name` | `profiles.full_name` | rename |
| `email` | `auth.users.email` | direct |
| `isActive` | `profiles.is_active` | rename |
| `role` | `company_users.role` | cast to enum |
| `createdAt` | `profiles.created_at` | timestamptz |
| `updatedAt` | `profiles.updated_at` | timestamptz |
| `password` | Supabase Auth | auth API |

---

### AppSession

| Source | Destination | Status |
|---|---|---|
| `AppSession` | — | **Skip** |

---

### ChartOfAccount → `chart_of_accounts`

| Prisma | Supabase | Transform |
|---|---|---|
| `id` | `id` + `legacy_id` | map_uuid + legacy |
| — | `company_id` | fixed tenant |
| `accountNo` | `account_no` | rename |
| `fullName` | `full_name` | rename |
| `name` | `name` | direct |
| `parentNo` | `parent_no` | rename |
| `accountType` | `account_type` | rename |
| `subType` | `sub_type` | rename |
| `isActive` | `is_active` | rename |
| `description` | `description` | direct |
| `balance` | `balance` | float→numeric |
| `createdAt` | `created_at` | timestamptz |
| `updatedAt` | `updated_at` | timestamptz |
| — | `deleted_at` | NULL |

---

### CostCenter → `cost_centers`

Same pattern as COA: `code`, `name`, `type`, `description`, `is_active`, timestamps, `company_id`, `legacy_id`.

---

### TaxRate → `tax_rates`

| Prisma | Supabase | Transform |
|---|---|---|
| `rate` | `rate` | float→numeric(8,4) |
| `isDefault` | `is_default` | rename |
| `isActive` | `is_active` | rename |
| No `updatedAt` in Prisma | `deleted_at` | NULL |

---

### Sequence → `sequences`

See [Sequence migration strategy](#sequence-migration-strategy).

---

### Customer → `customers`

All address/ZATCA buyer fields map 1:1 (`streetAddress`→`street_address`, etc.). `creditLimit` float→numeric.

---

### Vendor → `vendors`

Standard rename map; `company_id` + `legacy_id`.

---

### Employee → `employees`

| Prisma | Supabase |
|---|---|
| `employeeNo` | `employee_no` |
| `joiningDate` | `joining_date` |
| `salaryType` | `salary_type` |
| `bankAccount` | `bank_account` |

---

### InventoryItem → `inventory_items`

| Prisma | Supabase |
|---|---|
| `itemCode` | `item_code` |
| `costPrice` | `cost_price` |
| `salePrice` | `sale_price` |
| `minQuantity` | `min_quantity` |

---

### JournalEntry → `journal_entries`

| Prisma | Supabase | Transform |
|---|---|---|
| `entryNo` | `entry_no` | rename |
| `totalDebit` | `total_debit` | numeric |
| `totalCredit` | `total_credit` | numeric |
| `createdById` | `created_by_id` | map_fk → profiles |
| `status` | `status` | direct (respect `POSTED` balance CHECK from 010) |

---

### JournalLine → `journal_lines`

| Prisma | Supabase | Transform |
|---|---|---|
| `journalId` | `journal_id` | map_fk |
| `accountId` | `account_id` | map_fk |
| `costCenterId` | `cost_center_id` | map_fk nullable |
| — | `company_id` | fixed + composite FK |

---

### Receipt → `receipts`

| Prisma | Supabase |
|---|---|
| `fileName` | `file_name` |
| `filePath` | `file_path` |
| `mimeType` | `mime_type` |
| `uploadedById` | `uploaded_by_id` → profiles |

---

### Expense / ExpenseLine → `expenses` / `expense_lines`

Standard maps; `receiptId`→`receipt_id`, `expenseId`→`expense_id`.

---

### Bill / BillLine → `bills` / `bill_lines`

| Prisma | Supabase |
|---|---|
| `billNo` | `bill_no` |
| `vendorId` | `vendor_id` |
| `amountPaid` | `amount_paid` |
| Line fields | same as invoice_lines pattern |

---

### Invoice → `invoices` (ZATCA-critical)

| Prisma field | Supabase column | Transform | Preserve requirement |
|---|---|---|---|
| `id` | `id` + `legacy_id` | map_uuid | cuid in legacy_id |
| `invoiceNo` | `invoice_no` | rename | ✓ |
| **`invoiceUUID`** | **`invoice_uuid`** | **direct** | **✓ required** |
| **`invoiceHash`** | **`invoice_hash`** | **direct** | **✓ required** |
| **`previousInvoiceHash`** | **`previous_invoice_hash`** | **direct** | **✓ required** |
| `invoiceType` | `invoice_type` | cast enum | ✓ |
| `customerId` | `customer_id` | map_fk | ✓ |
| `issueTime` | `issue_time` | direct | ✓ |
| `dueDate` | `due_date` | timestamptz | ✓ |
| `taxAmount` | `tax_amount` | numeric | ✓ |
| `amountPaid` | `amount_paid` | numeric | ✓ |
| **`zatcaStatus`** | **`zatca_status`** | cast enum | ✓ |
| `clearanceStatus` | `clearance_status` | direct | ✓ |
| `zatcaResponseCode` | `zatca_response_code` | direct | ✓ |
| `zatcaResponseMessage` | `zatca_response_message` | direct | ✓ |
| `zatcaFailureCode` | `zatca_failure_code` | direct | ✓ |
| `zatcaRequestId` | `zatca_request_id` | direct | ✓ |
| `zatcaResponsePayload` | `zatca_response_payload` | **json** (parse String) | ✓ |
| `clearedInvoicePayload` | `cleared_invoice_payload` | **json** | ✓ |
| **`signedXml`** | **`signed_xml`** | **direct** (full TEXT) | **✓ required** |
| `zatcaSubmissionDate` | `zatca_submission_date` | timestamptz | ✓ |
| `createdById` | `created_by_id` | map_fk | ✓ |
| **`createdAt`** | **`created_at`** | timestamptz | **✓ hash chain order** |

**Hash chain note:** Current SQLite has `previousInvoiceHash` NULL for all hashed invoices; chain logic uses prior row by `created_at`. Migration **must preserve `created_at` exactly** (millisecond precision) for hashed invoices.

**Post-load validation:** Re-run hash-chain ordering query — for each invoice with `invoice_hash`, verify prior hashed invoice by `created_at` matches expected PIH logic.

---

### InvoiceLine → `invoice_lines`

Map `invoiceId`, `accountId`, `costCenterId`; numeric line amounts; `company_id` for composite FK.

---

### Payment → `payments`

Map `invoiceId`/`billId` through ID map; preserve `paymentNo`, `method`, `amount`, `created_at`.

---

### PayrollEntry / PayrollLine → `payroll_entries` / `payroll_lines`

Standard numeric + FK maps.

---

### ZatcaCredential → `zatca_credentials`

| Prisma | Supabase | Transform | Preserve |
|---|---|---|---|
| `id` | `id` + `legacy_id` | map_uuid | ✓ |
| `companySettingsId` | **`company_id`** | fixed tenant | ✓ |
| `environment` | `environment` | cast enum | ✓ |
| `egsUnitId` | `egs_unit_id` | rename | ✓ |
| `csr` | `csr` | direct | ✓ |
| **`csrEnc`** | **`csr_enc`** | **direct ciphertext** | **✓** |
| **`privateKeyEnc`** | **`private_key_enc`** | **direct ciphertext** | **✓** |
| `certificate` | `certificate` | direct | ✓ |
| **`certificateEnc`** | **`certificate_enc`** | **direct ciphertext** | **✓** |
| **`secretEnc`** | **`secret_enc`** | **direct ciphertext** | **✓** |
| **`binarySecurityTokenEnc`** | **`binary_security_token_enc`** | **direct ciphertext** | **✓** |
| **`complianceCsid`** | **`compliance_csid`** | **direct** | **✓ required** |
| `requestId` | `request_id` | rename | ✓ |
| **`productionCsid`** | **`production_csid`** | **direct** | **✓ required** |
| `productionCertificate` | `production_certificate` | direct | ✓ |
| **`productionCertificateEnc`** | **`production_certificate_enc`** | **direct ciphertext** | **✓** |
| `onboardingStatus` | `onboarding_status` | cast enum | ✓ |
| `lastError` | `last_error` | rename | ✓ |
| `onboardedAt` | `onboarded_at` | timestamptz | ✓ |

**Upsert key:** `(company_id, environment)` — SQLite had global `@unique` on `environment`; Supabase scopes per tenant.

**Pre-flight:** Confirm `ZATCA_CREDENTIAL_ENCRYPTION_KEY` in target environment matches SQLite runtime key (or document re-encryption step if keys differ).

---

### ZatcaOnboardingRequest → `zatca_onboarding_requests`

| Prisma | Supabase |
|---|---|
| `companySettingsId` | `company_id` (fixed tenant) |
| `egsUnitId` | `egs_unit_id` |
| `requestId` | `request_id` |
| `errorMessage` | `error_message` |

---

### ZatcaAuditLog → `zatca_audit_logs`

| Prisma | Supabase | Transform |
|---|---|---|
| `userId` | `user_id` | map_fk → profiles (nullable) |
| `userName` | `user_name` | rename |
| `companyName` | `company_name` | rename |
| `invoiceId` | `invoice_id` | map_fk (nullable) |
| **`metadata`** | **`metadata`** | **json** (parse String JSON) |
| — | **`company_id`** | fixed tenant (required in Supabase) |

---

### ZatcaSandboxTestRun → `zatca_sandbox_test_runs`

| Prisma | Supabase | Transform |
|---|---|---|
| **`steps`** | **`steps`** | **json** (parse String JSON array) |
| `durationMs` | `duration_ms` | rename |
| — | `company_id` | fixed tenant |

---

### Tables with no SQLite source (skip load)

| Supabase table | Action |
|---|---|
| `company_subscriptions` | Keep seed row |
| `invitations` | Empty |
| `user_preferences` | Created by auth trigger on user insert |
| `zatca_xml_archive` | Empty unless future export adds rows |
| `zatca_api_logs` | Empty |

---

## Transformations reference

| Transform | Rule |
|---|---|
| `direct` | Copy value unchanged |
| `rename` | camelCase → snake_case |
| `float→numeric` | `ROUND(value, 4)` or string cast to `NUMERIC(18,4)` |
| `timestamptz` | SQLite ISO-8601 → PostgreSQL `TIMESTAMPTZ` (preserve offset) |
| `cast enum` | Map to Postgres enum label (same strings as Prisma) |
| `json` | `metadata`, `steps`, `zatcaResponsePayload`, `clearedInvoicePayload`: parse JSON string; invalid JSON → migration error (do not silently drop) |
| `map_fk` | Replace cuid with mapped Supabase UUID |
| `fixed` | Set constant (e.g. `company_id`) |

---

## Validation strategy

### Phase C9 — automated checks

1. **Row counts** — SQLite vs Supabase per table (±0).
2. **`012_migration_validation.sql`** — schema/RLS/FK/index/orphan checks (must pass).
3. **ID map completeness** — every SQLite PK appears in `migration_id_map`.
4. **Business key uniqueness** — no duplicate `(company_id, invoice_no)` etc.
5. **Composite FK orphans** — section 10 of `012` returns zero rows.

### ZATCA-specific validation

| Check | Query concept |
|---|---|
| Invoice UUID parity | Count + checksum sample: SQLite `invoiceUUID` = Supabase `invoice_uuid` |
| Hash parity | `invoiceHash` exact match for all 17+ hashed rows |
| PIH column parity | `previousInvoiceHash` exact match (including NULLs) |
| `created_at` order | Hashed invoices ordered identically by `created_at` |
| CSID parity | `compliance_csid`, `production_csid` exact match per environment |
| Encrypted field lengths | `LENGTH(csr_enc)`, `LENGTH(private_key_enc)` match SQLite |
| Credential decrypt smoke test | Server-side decrypt one SANDBOX field post-load (Phase C script, not app change) |
| Audit log coverage | 206 rows; `invoice_id` FK resolves for non-null refs |
| Onboarding requests | 41 rows; `(company_id, environment)` index populated |

### Financial sanity

- Sum of `invoices.total` matches SQLite
- `sequences.next_no` matches for all 11 types
- Posted journal entry (`status=POSTED`) satisfies `total_debit = total_credit`

---

## Rollback strategy

### Before migration

1. **Supabase snapshot** — point-in-time backup or `pg_dump` of `public` schema.
2. **Export SQLite** — copy `prisma/dev.db` to timestamped backup.
3. **Save artifacts** — `migration_id_map`, row-count manifest, validation query outputs.

### Rollback procedure (tenant-scoped)

Execute in reverse dependency order using **`legacy_id IS NOT NULL`** as migration marker:

```
DELETE FROM zatca_sandbox_test_runs WHERE legacy_id IS NOT NULL;
DELETE FROM zatca_audit_logs WHERE legacy_id IS NOT NULL;
DELETE FROM zatca_onboarding_requests WHERE company_id = :tenant;
DELETE FROM zatca_credentials WHERE company_id = :tenant;
-- … payroll, payments, invoice_lines, invoices, … through chart_of_accounts
-- Reset company row to seed defaults OR restore from pg_dump
-- Remove auth users created for migration (if applicable)
```

Alternatively: **restore full `pg_dump`** if rollback window is short.

### Re-run safety

Deterministic UUID + `INSERT … ON CONFLICT (legacy_id)` or upsert by `(company_id, business_key)` allows idempotent re-import after rollback.

---

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Encryption key mismatch | ZATCA credentials unusable | Verify key before load; keep SQLite backup |
| `created_at` drift | Hash chain breaks | Copy timestamps exactly; validate order |
| JSON parse failures on payloads | Lost ZATCA response data | Fail migration row; manual fix |
| Composite FK violation | Load fails | Enforce parent-first order; set matching `company_id` |
| Duplicate seed company vs SQLite TRN mismatch | Wrong tenant data | UPDATE seed row, do not INSERT new company |
| `previousInvoiceHash` all NULL | Chain relies on runtime PIH lookup | Document; optional post-migration backfill script (Phase C+1, optional) |
| Auth user UUID ≠ profile trigger | Orphan profiles | Create auth users first; use their UUID as `profiles.id` |

---

## Deliverables (Phase C implementation — not in this document)

| Artifact | Purpose |
|---|---|
| `scripts/db/export-sqlite.mjs` | Read `dev.db` → JSONL/CSV |
| `scripts/db/migrate-sqlite-to-supabase.mjs` | Load with ID map |
| `migration_id_map.json` | FK resolution |
| `013_data_migration.sql` or staged SQL | Optional bulk COPY |
| Phase C validation script | Extends `012` with row-count diffs |
| Runbook | Operator steps for demo + production cutover |

---

## Sign-off checklist (before Prisma removal)

- [ ] All SQLite tables mapped and row counts match
- [ ] `invoice_uuid`, `invoice_hash`, CSIDs byte-identical on sample + full count checks
- [ ] Encrypted ZATCA fields decrypt successfully in target environment
- [ ] `012_migration_validation.sql` summary returns PASS
- [ ] `sequences.next_no` matches SQLite (document numbering continues correctly)
- [ ] Demo users can authenticate via Supabase Auth
- [ ] Rollback snapshot verified restorable

---

*Generated from analysis of `prisma/schema.prisma`, migrations `001`–`012`, seed `001_default_company.sql`, and live `prisma/dev.db` inventory.*
