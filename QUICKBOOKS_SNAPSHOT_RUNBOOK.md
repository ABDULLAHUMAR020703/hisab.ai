# QuickBooks Raw Snapshot → hisab.ai Migration Runbook

The migration now runs in two fully separated phases:

```
QuickBooks Online
   → snapshot extraction  → immutable raw snapshot in Supabase Storage (bucket: quickbooks-migration)
   → validation           → snapshot.status = COMPLETE | PARTIAL | FAILED
   → snapshot-backed migration (reads Storage, never calls QuickBooks)
   → hisab.ai database
```

A migration failure no longer forces re-extraction. A COMPLETE snapshot can be migrated,
and re-migrated, with zero further QuickBooks API calls.

---

## 0. One-time DB migration

Apply `supabase/migrations/069_quickbooks_migration_snapshots.sql` (snapshot tables,
`import_jobs.snapshot_id`, the one-active-step queue guard, and a re-assert that the
`quickbooks-migration` bucket is private). No data migration; additive only.

---

## 1. Pre-flight checklist — MUST all be checked before a real client extraction

- [ ] **Correct QuickBooks realm / company.** `GET /api/integrations/quickbooks` (or the
      connection row) shows the intended `realmId` + company name, `status = CONNECTED`.
- [ ] **Correct environment.** Server `QB_ENVIRONMENT` and the connection environment match
      (production for a real client). `assertMigrationConnectionReady` enforces this.
- [ ] **Correct destination hisab company.** The tenant you run the CLI / API as is the
      company the data should land in.
- [ ] **No other migration session is active** for that company
      (`GET /api/import-export/migration-sessions` returns no active session).
- [ ] **Supabase Storage capacity confirmed — BLOCKING GATE.** Open the Supabase project
      dashboard → Storage, and confirm there is comfortably more free capacity than the
      snapshot will need, plus headroom. There is **no estimated snapshot size** in this
      system — do not start extraction until a human has looked at the dashboard and
      confirmed capacity. If the project is near its plan limit, upgrade the plan or the
      storage add-on first.
- [ ] **Extraction is read-only toward QuickBooks.** The extractor only issues `SELECT`
      queries and attachment downloads. It never creates, updates, or deletes QuickBooks
      records or configuration.

---

## 2. Run the extraction

A running worker (`npm run worker`) processes snapshot steps automatically, OR use
`--drive` to run the steps in-process.

```powershell
# With a worker running elsewhere:
npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/snapshot.ts create

# Self-contained (no separate worker): runs every step to a terminal snapshot, prints the report
npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/snapshot.ts create --drive
```

Optional: `--resources=accounts,customers,invoices` to limit the resource set (default is
the full supported inventory).

API equivalent: `POST /api/import-export/quickbooks-snapshots` (body optional
`{ "resources": [...] }`) → `{ snapshot: { id, ... } }`.

Continuation between extraction steps uses the same durable model as the import
migration (`QUICKBOOKS_IMPORT_STEP`): each step schedules the next from a
post-complete hook after its own queue row is `COMPLETED`, and `job_queue`
ownership / heartbeat / retry (`maxAttempts` 5) apply. A worker crash mid-step is
recovered by the platform's stale-`RUNNING` reclaim. If a snapshot ever sits
`RUNNING` with no progress for several minutes (a hook that never ran), resume it:

```
POST /api/import-export/quickbooks-snapshots/<snapshotId>/retry
```

The same endpoint resumes a `PARTIAL` / `FAILED` snapshot — failed / stuck
resources reset to `pending`, completed resources are kept, extraction continues
from each resource's checkpoint.

### Production operation — creating a snapshot exactly once

- **Use the authenticated, tenant-scoped API** `POST /api/import-export/quickbooks-snapshots`
  (or the server-side `createSnapshot(...)` with the tenant's `companyId` /
  `realmId` hard-coded). **Do not** use `scripts/quickbooks/snapshot.ts create`
  for a specific client — its `resolveConnection()` picks the most-recently-updated
  `CONNECTED` connection across **all** tenants and can bind to the wrong company.
- Create the snapshot **once**. If the create call times out or returns an
  ambiguous result, **inspect the DB / job state before retrying**:
  `SELECT id,status,created_at FROM quickbooks_migration_snapshots WHERE company_id=… AND realm_id=… ORDER BY created_at DESC;`
  and `SELECT id,status FROM job_queue WHERE job_type='QUICKBOOKS_SNAPSHOT_STEP' AND status IN ('PENDING','RUNNING');`
- Never manually enqueue a `QUICKBOOKS_SNAPSHOT_STEP` — the create route and the
  post-complete hook are the only things that should.

### Authentication during a long attachment extraction

Attachment capture can run for tens of minutes and a QBO access token lives
~1 hour. An access-token expiry mid-step is **recovered automatically**: the
provider auth exception propagates to `ConnectionService.executeWithAccessToken`,
which refreshes the token and replays the step. The replay is idempotent — an
already-`captured` attachment is not re-downloaded and no Storage object is
duplicated. It is **not** silently turned into a `failed` attachment.

If the **refresh token** itself is dead, the step keeps failing, the job
dead-letters, and the snapshot sits `RUNNING` with a stalled heartbeat —
reconnect QuickBooks, then `POST …/retry`.

### The storage-budget model (Free plan, 1 GB project-wide)

- Required-core and required-transactional resources are captured **first** and
  are never sacrificed for attachments. `attachments` is always the last resource.
- At the start of the attachment phase, project-wide Storage usage is measured
  across **every** bucket (`company-files` included). The attachment byte budget is
  `quota (1,000,000,000) − measured usage − reserve (170,000,000)`, persisted on
  the snapshot row (`attachment_budget_bytes`).
- Each attachment is captured only if it fits the remaining budget (checked
  against the QuickBooks-reported size, then re-checked against the real bytes);
  otherwise it is recorded `skipped_budget` and **never uploaded**. The ceiling is
  enforced in application code, not by a Supabase quota rejection.
- **Budget exhaustion is not a snapshot failure.** The snapshot can still reach
  `COMPLETE` if every required resource is `completed` and validation passes.
- The `QB_SNAPSHOT_STORAGE_QUOTA_BYTES` / `QB_SNAPSHOT_STORAGE_RESERVED_BYTES`
  env overrides are sanitised — a non-positive quota, or a reserve ≥ quota, is
  rejected in favour of the safe defaults. In production **neither is set**.
- Per-attachment outcome (`captured` / `skipped_budget` / `failed` / `unavailable`,
  size, sha256, Storage path, reason) is in `quickbooks_snapshot_attachments`.
  The report's ATTACHMENTS block shows `CAPTURED n / total` and `Coverage %`.

### Retention and cleanup of raw snapshots

- Snapshot page files and attachment binaries are **immutable** once written.
- Snapshot-backed migration points `documents.file_path` **directly** at the
  snapshot's attachment objects (zero-copy). **A snapshot whose attachments have
  been migrated must be retained** — deleting its Storage prefix breaks those
  `documents` rows.
- A superseded snapshot's Storage prefix is cleared **only** through the approved
  cleanup procedure (recursive delete scoped to exactly
  `<companyId>/quickbooks/<realmId>/snapshots/<snapshotId>/`), never the Supabase
  dashboard "delete folder" (it times out on the attachment folder tree).
- The DB row is kept as an inert audit record; do not delete it.
- **Retention duration is an operator decision** — this project has not set one.
  Until it does, keep every `COMPLETE` snapshot that has been (or may be) migrated.

---

## 3. Verify the snapshot before migrating

```powershell
npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/snapshot.ts status <snapshotId>

npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/snapshot.ts report <snapshotId>
```

API: `GET /api/import-export/quickbooks-snapshots/<snapshotId>` (JSON) and
`GET /api/import-export/quickbooks-snapshots/<snapshotId>/report` (text).

The report separates three states — **do not treat UNSUPPORTED or FAILED as done**:

| Section | Meaning | Migration impact |
|---|---|---|
| **COMPLETE / extracted** | Every page pulled and validated (pages, records). | Migrated. |
| **UNSUPPORTED / unavailable** | The QuickBooks company/edition does not expose this entity. Each line shows the Intuit reason + HTTP status. | Skipped. If the resource is *required* the snapshot cannot be COMPLETE. |
| **FAILED** | Extraction errored. Each line shows the error. | Blocks COMPLETE for required resources; `retry` to re-attempt. |

**Only proceed when `Status: COMPLETE` and `Validation: PASS`.** Validation independently
checks: every requested resource terminal; page numbering contiguous; no duplicate
QuickBooks `Id` across the whole resource *and across all date partitions*; partition
windows gap-free and non-overlapping; page JSON valid; manifest counts reconcile.

---

## 4. Run the snapshot-backed migration

```powershell
npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/snapshot.ts migrate <snapshotId> --strategy=update
```

This creates a normal migration session whose `config.snapshotId` is set; every import job
carries `snapshot_id` + `payload_snapshot.snapshotId`. The worker processes it exactly like
a live migration **except** each page is read from
`quickbooks-migration/<companyId>/quickbooks/<realmId>/snapshots/<snapshotId>/<resource>/page-NNNNNN.json`
instead of QuickBooks. Duplicate strategy, checkpoints, cumulative progress, ownership,
cancel/resume, and `quickbooks_migration_records.source_payload` archiving are unchanged.

API: `POST /api/import-export/migration-sessions` with the usual body plus
`"snapshotId": "<id>"`. If the snapshot is not COMPLETE the request is rejected with
`"QuickBooks snapshot is not complete."`

**Re-running the migration** against the same `snapshotId` (new session) replays from
Storage with no QuickBooks calls. Confirm this by checking the worker logs / external
request diagnostics show no `quickbooks.api.intuit.com` traffic during migration.

---

## 5. Storage layout

```
quickbooks-migration/                       (private bucket, public = false, 100 MB/file)
  <companyId>/quickbooks/<realmId>/snapshots/<snapshotId>/
    manifest.json
    accounts/page-000001.json
    invoices/page-000001.json  page-000002.json ...        (page-NNNNNN-part-NN.json if a page > ~40 MB)
    customer-payments/page-000001.json                     (raw QBO Payment entities)
    attachments/<attachableId>/<file>                      (only for CAPTURED attachments)
    ...
```

The per-attachment index is the `quickbooks_snapshot_attachments` DB table (not a
Storage object) — one row per Attachable with its capture status, size, sha256,
and Storage path.

Each `page-*.json` holds the raw QuickBooks entities exactly as the API returned them
(`Id`, `SyncToken`, `MetaData`, `Line`, refs, `CustomField`), plus page metadata. The
migration reader re-runs the existing `QuickBooksImportAdapter.normalizeRecords()` +
`filterResourceRows()` on these raw records, so the normalized rows are equivalent to a
live extraction of the same data.

---

## 6. Security

- Bucket is private (`public = false`); no signed or public URLs are generated for snapshot
  objects. All access is server-side via the service-role admin client (`import 'server-only'`).
- Snapshot pages contain QBO entity data only — never OAuth tokens or secrets.
- Logs are page-level (`snapshot`, `resource`, `page`, `records`, `status`) — never record
  bodies, tokens, or keys.
- Nothing is written to Git or `public/`; `.gitignore` is unchanged.

---

## 7. Verification status (see the implementation report for detail)

Covered by automated tests (`npm run test:quickbooks-snapshot`, 56 tests): the full
assembled lifecycle over an in-memory Supabase — create → worker continuation steps →
pages in Storage → checkpoints advance → validation → COMPLETE → snapshot-backed migration
read via `fetchSnapshotResourcePage` with **zero QuickBooks calls** (and zero again on
re-run); the provider partition-boundary fix; attachment metadata-vs-binary separation.

Rebased onto `origin/master` (`ab0c758`): the snapshot continuation follows master's
post-complete-hook model, and snapshot-backed accounts/customers/vendors pages go through
master's page-batch `processImport` path (proven by `quickbooks-snapshot-batching.test.ts`).

Still requires a live QuickBooks Sandbox / production run:
- Real HTTP networking, OAuth token refresh mid-extraction, the real attachment
  `TempDownloadUri` download flow, and very large realms (>40 MB pages, many date windows).
- `snapshot-step` connection resolution (`executeForProvider`) and the parts of
  `handleImport` downstream of the page read (`processImport`, module `createRecord`,
  accounting materialization) running from a snapshot.
- **Supabase Storage plan quota / egress headroom** — the operator pre-flight gate in §1.
