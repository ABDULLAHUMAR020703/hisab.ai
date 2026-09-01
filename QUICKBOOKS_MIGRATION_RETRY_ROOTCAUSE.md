# QuickBooks Migration — Retry Count & Performance Root-Cause Investigation

**Status:** Investigation only. No code changed. All file/line references are against the
current checkout of `Techdotglobal/hisab.ai` (`master`, commit `ae4f921`).

---

## 1. Executive Summary

1. **`progress_snapshot.retryCount` is not a retry counter.** It is a *derived telemetry
   figure* computed in `MigrationTrace.snapshot()`
   (`src/lib/import-export/quickbooks/migration-telemetry.ts:206`) as:

   ```ts
   retryCount: [...this.requests.values()].reduce((sum, item) => sum + Math.max(0, item.calls - 1), 0)
   ```

   In words: **for every distinct outbound HTTP request "signature" observed during the
   step, add `(number of times that signature was sent − 1)`.** It is the count of
   *repeated identical outbound requests* — a de-duplication deficit / "N+1" measure across
   **both** Supabase (PostgREST) and QuickBooks calls. It counts *successful* repeats. It
   has nothing to do with failures, HTTP retries, continuations, or `import_jobs.retry_count`.

2. **Why the numbers are huge:** PostgREST **writes** (`insert`, `upsert`) carry their
   payload in the request body, so every `upsert` to the same table with the same
   `on_conflict`/`select` query string collapses to **one signature**. The materializer
   issues 5–11 such fixed-signature writes *per record*
   (`quickbooks_migration_records`, `quickbooks_migration_local_links`, the native table
   insert, the document-sequence allocation, `quickbooks_materialization_runs` state
   transitions, …). With 100 records in a page that is 500–1,100 repeats of a handful of
   signatures. Add the progress-persistence `SELECT *` + `UPDATE` on `import_jobs` (fired
   on *every* trace event) and the queue heartbeat `PATCH`, and a single 100-record page
   legitimately produces `retryCount` in the 900–1,300 range. Per-record `SELECT`s
   (filtered by `source_id`/`id`) have *unique* signatures and therefore do **not** inflate
   the number.

3. **Why the migration is slow:** the pipeline is **strictly sequential, one record at a
   time, one HTTP round-trip at a time**, ~8–14 Supabase round-trips per record at
   ~200–450 ms each (worker → Supabase pooler → PostgREST → RLS → Postgres → back). That
   is ~2.5–5 s of wall time per record ⇒ the observed **0.2–0.4 rows/sec**. "Database
   wait" is simply the **sum of these HTTP request durations**, not lock contention — which
   is exactly why the lock diagnostics came back empty.

4. **A second, structural slowdown:** after a page that has `hasMore = true`, **nothing in
   the request path successfully enqueues the next page.** The in-handler enqueue
   (`enqueueQuickBooksContinuationOnce`) always hits the `23505` unique-index guard because
   the current queue row is still `RUNNING`, and `advanceQuickBooksMigrationAfterImportJob`
   bails out for a non-terminal job. The **only** thing that starts the next page is the
   30-second `recoverOrphanedContinuations()` sweep. So every page boundary costs
   **0–30 s of dead time** (plus a 2 s worker poll). This is the "waiting / idle" bucket
   and the reason `quickbooks.continuation.recovered_created` precedes almost every
   `worker.job.claimed`.

5. **`failedNetworkCalls = 0` is fully consistent** with a large `retryCount`: they are
   computed from different fields of the same aggregate (`failedCalls` vs `calls − 1`).
   Nothing failed; things were merely repeated.

---

## 2. Migration Architecture Relevant to the Problem

```
worker/index.ts  (long-lived process "quickbooks-worker-<pid>")
  ├─ heartbeat loop            → worker_heartbeats           (every 30s)
  ├─ recovery loop             → recoverOrphanedContinuations (every 30s)   ← pumps pages
  └─ main loop: processJobBatch(1, 'QUICKBOOKS_IMPORT_STEP')
       └─ claimNextJob()                         src/lib/platform/jobs/queue.ts
       └─ processJob()                           src/lib/platform/jobs/workers.ts
            └─ handler 'QUICKBOOKS_IMPORT_STEP'  workers.ts:200
                 └─ runImportJobStep()           src/app/api/import-export/[module]/import/route.ts:533
                      ├─ new MigrationTrace(..., { onEvent })          telemetry, per step
                      ├─ createProgressWriteQueue()                    serialized progress writes
                      ├─ withExternalRequestDiagnostics({ onRequest: trace.request })
                      │    └─ handleImport()                           route.ts:90
                      │         ├─ trace.measure('module_scheduling', …)
                      │         ├─ trace.measure('extraction',   fetchSourceResourcePage)  ← QB page of 100
                      │         ├─ trace.measure('validation',   buildMappedImportPayload)
                      │         ├─ trace.measure('duplicate_detection', detectDuplicates)
                      │         ├─ trace.measure('materialization', processImport)          ← the loop
                      │         │    └─ for each record (sequential):
                      │         │         archive() → assertQuickBooksDependencies()
                      │         │         → module.createRecord()/updateRecord()
                      │         │         → archive(localId) → assertQuickBooksRecordLinked()
                      │         │         → materializeQuickBooksAccounting()
                      │         │         → assertQuickBooksAccountingCompleted()
                      │         │    └─ onProgress()  (once per batch) → updateImportJobProgress()
                      │         ├─ sourcePage.commit()   → quickbooks_migration_checkpoints upsert
                      │         ├─ enqueueQuickBooksContinuationOnce()   ← always 23505, no-op
                      │         └─ finalizeImportJob()  (only on the final page)
                      └─ coordinateQuickBooksMigrationAfterStep()
                           └─ advanceQuickBooksMigrationAfterImportJob() ← only advances to next MODULE
```

Key facts:

- **Batching:** source-backed steps run `batchSize: 100`, `maxBatches: 1`
  (`route.ts:258-259`). The QuickBooks adapter's bounded page is also 100
  (`quickbooks.adapter.ts:162-163`, `maxPages: 1`, `pageSize: 100`). One worker step =
  one QB page = up to 100 records.
- **Every Supabase client is instrumented.** `createAdminClient()` and the server client
  both set `global: { fetch: diagnosticFetch }` (`src/lib/supabase/admin.ts:13`,
  `src/lib/supabase/server.ts:12`). Every PostgREST call passes through
  `diagnosticFetch` → `context.onRequest` → `MigrationTrace.request`.
- **`resolveCompanyId()` is free in the worker** — `withCompanyContext()` puts the tenant
  in an `AsyncLocalStorage` and `resolveCompanyId()` returns it without a DB hit
  (`src/lib/tenant.ts:39-40`). It is *not* a query contributor on the worker path.
- **Continuation identity guard:** `job_queue_one_active_quickbooks_step_idx` — a unique
  partial index on `(company_id, job_type, payload->>'importJobId') WHERE status IN
  ('PENDING','RUNNING')` (`supabase/migrations/067_quickbooks_durable_scheduler_guards.sql`).
  Guarantees at most one active step per import job; makes duplicate concurrent
  materialization impossible.

---

## 3. Retry Counter Trace — every increment / persistence / consumer

There are **five** distinct counters in play. Only #4 is what the Migration Center shows
as "retryCount".

### 3.1 `import_jobs.retry_count` (DB column)

| Property | Value |
|---|---|
| File / fn | `incrementImportJobRetry()` — `src/lib/import-export/jobs/import-job.service.ts:357-364` |
| Behavior | `UPDATE import_jobs SET retry_count = retry_count + 1, status = 'pending' …` |
| Triggered by | **Only** an explicit user action: `retryQuickBooksMigrationSession()` (`migration-session.service.ts:956`) and `POST /api/import-export/jobs/[jobId]/retry` (`retry/route.ts:12`) |
| On failure only? | It is a *manual resume*, not automatic. Never fired by the worker, the trace, materialization, or continuation. |
| Increment in a loop? | No |
| Persisted? | Yes (column) |
| Reset? | Never reset; accumulates across manual resumes |
| Consumers | `mapJobRow()` → `ImportJobRecord.retryCount` (`import-job.service.ts:48`); surfaced at `GET /api/import-export/jobs/[jobId]` (`jobs/[jobId]/route.ts:59`) |

**This is why `import_jobs.retry_count = 0` in your runs — nobody clicked Retry.**

### 3.2 `job_queue.attempts` (DB column)

| Property | Value |
|---|---|
| File / fn | `claimNextJob()` — `src/lib/platform/jobs/queue.ts:71` (`attempts: Number(job.attempts) + 1` on claim) |
| Also | `failJob()` (`queue.ts:142-181`): if `attempts >= max_attempts` (default 3) → `FAILED` + `dead_letter_queue`; else → back to `PENDING` with `scheduled_at = now + 2^attempts s` |
| Triggered by | Each time the queue row is claimed by a worker; re-queued only on a **thrown** handler error |
| Increment in a loop? | Once per claim |
| Persisted? | Yes |
| Reset? | Not per step; a brand-new continuation row starts at `attempts = 0` |
| Consumers | `ownership` guard (`attempt` threaded through `createJobOwnership`), `heartbeatJob(jobId, attempt)`, logs (`quickbooks.worker.job.claimed … attempt`) |

### 3.3 `quickbooks_materialization_runs.attempt_count` (DB column)

| Property | Value |
|---|---|
| File / fn | `materializeQuickBooksAccounting()` — `accounting-materializer.ts:104`: `attempt_count: Number(existing.data?.attempt_count ?? 0) + 1` |
| Triggered by | Every call to `materializeQuickBooksAccounting` for a source record **whose module is in `CONFIG`** (invoices, bills, expenses, payments, journal-entries, payroll, estimates, purchase-orders, sales-receipts, vendor-credits, and the `qb-*` extended modules incl. `qb-employees`, `qb-tax-agencies`, `qb-tax-configurations`, `qb-inventory-adjustments`, …). **Not** `vendors`, `customers`, `accounts`, `tax-rates`, `payment-terms` (no `CONFIG` entry → the function returns before touching the DB, `accounting-materializer.ts:87-88`). |
| On failure only? | No — increments on **every** attempt, including the first and including successful ones. It only *skips* incrementing when a prior run is already `completed` for the same `local_id` (`accounting-materializer.ts:96-98`). A record re-seen on a later page (re-extraction) increments it again. |
| Increment in a loop? | Once per `materializeQuickBooksAccounting` call |
| Persisted? | Yes (column, upserted) |
| Reset? | Never |
| Consumers | Written into `quickbooks_materialization_runs`; read back by `assertQuickBooksAccountingCompleted` / `getQuickBooksMaterializationStatus` (status only, not the count). **Not surfaced to the UI as retryCount.** |

### 3.4 `progress_snapshot.retryCount` — **the number the Migration Center shows**

| Property | Value |
|---|---|
| Computed in | `MigrationTrace.snapshot()` — `migration-telemetry.ts:206` |
| Formula | `Σ over distinct (kind:signature) of max(0, calls − 1)` where `calls` is incremented in `MigrationTrace.request` (`migration-telemetry.ts:167-176`) for **every** outbound Supabase or QuickBooks HTTP request in the step |
| `signature` def | `sha256("<METHOD> <host><path>?<sorted query params>").slice(0,16)` — `src/lib/ops/external-request-diagnostics.ts:81-87`. **Request body is not part of the signature.** |
| Triggered / written | `snapshot()` is called inside `emitEvent()` (`migration-telemetry.ts:224`) and passed to the `onEvent` callback registered in `runImportJobStep` (`route.ts:585`). `onEvent` enqueues an `updateImportJobProgress()` write → persisted into `import_jobs.progress_snapshot` (JSONB). Also written by `handleImport`'s `onProgress` (`route.ts:245-252`, `trace.snapshot()`), and by `finalizeImportJob` via `finalizeProgressSnapshot` (`import-job.service.ts:393`). |
| On failure only? | **No.** Incremented for every *successful* repeated request. HTTP-level retries (see 3.5) also add to it, but those additionally bump `failedCalls`, and your `failedNetworkCalls = 0`, so ~all of it is successful repeats. |
| Increment in a loop? | Effectively yes — the materialization record loop issues fixed-signature upserts per record; each one past the first adds 1. |
| Persisted? | Yes, inside the `progress_snapshot` JSON on `import_jobs`. |
| Reset per step? | Each `runImportJobStep` builds a **fresh** `MigrationTrace` with an empty `requests` map, so the *raw* per-step value starts at 0. But… |
| Merge behavior | `mergeProgressSnapshot` (`progress-merge.ts:95`): `retryCount: maxNumber(prior.retryCount, next.retryCount)` — the persisted value is the **running maximum** across every step/snapshot for that module. It never decreases. So the displayed 1,128 is "the worst single step this module ever had", not a sum. |
| Consumers | `migration-center-view.ts:309` (`retryCount: snapshot.retryCount ?? 0`) → Migration Center module card. `progress-merge.ts` for persistence. Also `databaseQueries`, `databaseWrites`, `databaseTimeMs`, `apiRequests`, `apiTimeMs`, `activeProcessingMs` are computed the same way in the same `snapshot()` and merged with the same `maxNumber` (except `activeProcessingMs`, which is additive across steps via `initialActiveProcessingMs`). |

### 3.5 `diagnosticFetch` internal HTTP retry (`attempt` field)

| Property | Value |
|---|---|
| File / fn | `diagnosticFetch()` — `external-request-diagnostics.ts:91-116` |
| Behavior | For Supabase **retry-safe** methods (`GET/HEAD/OPTIONS/PUT/PATCH/DELETE`, plus `POST` with `Prefer: resolution=merge-duplicates`), up to `maxAttempts = 3`, retrying on HTTP `429` or `>= 500` with backoff `min(250·2^(n−1), 2000) ms`. |
| Counter | `attempt` (1..3), passed into each `context.onRequest({ …, attempt, … })` call |
| Effect on telemetry | **Each attempt is a separate `onRequest` call**, so a retried request adds `+1` to `calls` *and* `+1` to `failedCalls` for its signature. It therefore *does* inflate `retryCount` — but also `failedNetworkCalls`. |
| Your evidence | `failedNetworkCalls = 0` ⇒ this path did **not** fire in the runs in question. The large `retryCount` is not from HTTP retries. |

> Note: `src/lib/ops/retry.ts` (`withRetry`) has **no callers** anywhere in the codebase.
> There is no generic application-level retry wrapper in the migration path.

---

## 4. `retryCount` vs `retry_count` — exact semantic difference

| | `import_jobs.retry_count` | `progress_snapshot.retryCount` |
|---|---|---|
| Type | Integer DB column on `import_jobs` | Derived integer inside a JSONB blob |
| Meaning | "How many times a human pressed **Retry** on this module/session" | "How many outbound HTTP requests in the worst single step were byte-for-byte-URL repeats of an earlier request" |
| Written by | `incrementImportJobRetry()` only | `MigrationTrace.snapshot()` → merged with `maxNumber` |
| Scope | Whole import job, lifetime | Per step, then kept as a running max per module |
| Typical value in a healthy run | `0` | Hundreds to low thousands (this is "normal" for the current implementation) |
| Correlated with problems? | Yes — a non-zero value means the module failed and was resumed | Weakly — a *higher-than-peers* value flags a module with more per-record fixed-signature DB writes and/or more re-extraction, but it is elevated for **every** module by design |

They are **completely independent counters that happen to share a name stem.** The
Migration Center label "retryCount" is a misnomer; the field is really
`repeatedRequestCount` (in fact `MigrationTrace.finish()` logs exactly that set as
`repeatedRequests: requestList.filter(item => item.calls > 1)`,
`migration-telemetry.ts:243`).

---

## 5. Continuation / Recovery Analysis

### Components

- **`ensureContinuationForImportJob()`** — `src/lib/platform/continuation-scheduler.ts:6`.
  Checks for an active (`PENDING`/`RUNNING`) `QUICKBOOKS_IMPORT_STEP` row for the import
  job; if found returns `{ existing }`; else `enqueueJob(...)`; on `23505` re-reads and
  returns `{ existing }` (`quickbooks.continuation.race_existing`).
- **`enqueueQuickBooksContinuationOnce()`** — `route.ts:44`. Called from the
  `sourcePage.hasMore` branch (`route.ts:373`). Tries `enqueueJob` *unconditionally*; on
  `23505` re-reads and logs `quickbooks.import_job.continuation_already_queued`, returns
  `{ existing }`.
- **`recoverOrphanedContinuations()`** — `continuation-scheduler.ts:58`. Runs every 30 s
  from `worker/index.ts`. Selects `import_jobs` where `status = 'processing'` **and**
  `last_heartbeat_at < now − 5000ms`; for each, requires `processed_rows > 0` and
  `0 < processed_rows < total_rows`; skips if the session is cancelled; skips if an active
  queue row already exists; otherwise `enqueueJob(...)`
  (`quickbooks.continuation.recovered_created`). Emits
  `quickbooks.continuation.recover_summary { created, skipped, scanned }`.

### What actually happens on a page boundary

1. Step N processes 100 records, calls `sourcePage.commit()` (checkpoint upsert with
   `status: 'running'`, `extracted_count = priorFetched + 100`).
2. `enqueueQuickBooksContinuationOnce()` runs **while step N's queue row is still
   `RUNNING`** → the unique index `job_queue_one_active_quickbooks_step_idx` rejects the
   insert with `23505` → it returns `{ existing: <step N's own row> }`, logs
   `continuation_already_active`. **No new row is created.**
3. Handler returns → `coordinateQuickBooksMigrationAfterStep` →
   `advanceQuickBooksMigrationAfterImportJob`: the import job is still `processing`
   (non-terminal) → logs `advance_skipped: import_job_not_terminal`, returns. **No new row
   is created.**
4. `completeJob()` flips step N's row → `COMPLETED`. Now there are **zero** active queue
   rows for this import job, and the import job sits `processing` with
   `processed_rows (e.g. 100) < total_rows (e.g. 101)`.
5. `last_heartbeat_at` was last written during step N (by a progress event). It is now
   stale by more than 5 s.
6. On its next tick (0–30 s later), `recoverOrphanedContinuations()` matches this job,
   finds no active row, and `enqueueJob(...)` → `recovered_created`.
7. The worker main loop claims it within `IMPORT_WORKER_POLL_MS` (2 s).

**Conclusion:** `recovered_created` is **not** an error condition here — it is the *de facto
scheduler for every page after the first*. Expected per-boundary latency: mean ~15 s,
worst ~32 s. The `recover_summary { created: 0, skipped: 4, scanned: 4 }` lines you see
every 30 s are the sweep finding jobs that *do* still have an active row (mid-step) and
skipping them — normal.

### Does continuation/recovery touch `retryCount`?

**No.** Recovery only inserts a `job_queue` row. `retryCount` lives entirely inside a
per-step `MigrationTrace`. Recovery does bump `job_queue.attempts` on the *next* claim (§3.2),
and each recovered step re-runs extraction (re-fetching the same QB page it will process),
which re-issues the same fixed-signature upserts and thus contributes to *that step's*
`retryCount` — but there is no direct "recovery ⇒ retryCount++" path.

### Can the same batch be processed repeatedly?

Concurrent duplication: **no** (unique index). Sequential re-processing of *already-imported*
records: **possible but bounded** — if `next_start_position` in the checkpoint does not
advance, a step re-fetches an overlapping QB window. Duplicate detection
(`detectDuplicates` → `findDuplicatesBatch`) *should* catch already-created records and
route them to `skip`/`update` instead of `create`. The final vendor report ("586 imported"
for a module the UI briefly showed as "301") is most simply explained by
`estimatedTotalRecords` being a **lower bound** that lagged real extraction (see §9), not
by mass re-import — but re-extraction of trailing records on each page is a real, if minor,
contributor to both runtime and `retryCount` and should be confirmed with the checkpoint
data (see §19).

---

## 6. Materialization Analysis

Entry point: `processImport()` (`src/lib/import-export/import/import-processor.ts:58`),
wrapped by the route in `trace.measure('materialization', …)` (`route.ts:225`).

### Per-record work (the sequential inner loop, `import-processor.ts:106-210`)

For a **create** (no duplicate), non-extended module like `vendors`:

| Step | Fn | Supabase calls |
|---|---|---|
| `source_archive` | `archiveQuickBooksRecord(row)` — `migration-store.ts:32` | 1 `upsert quickbooks_migration_records …?on_conflict=…&select=*` (+ `company_currencies`/`companies`/`exchange_rates` **only if** the row has a `CurrencyRef`; vendors normally don't) |
| `dependency_validation` | `assertQuickBooksDependencies('vendors', …)` — `dependency-check.ts:52` | 0 (vendors have no refs) |
| `native_create` | `vendorsModule.createRecord` → `vendor.repository.supabase.ts:242` | `resolveSequenceRepository().next('VENDOR','VEND-')` (1–3 calls) + `insert vendors …?select=*` (1) |
| `source_link_archive` | `archiveQuickBooksRecord(row, localId)` | 1 `upsert quickbooks_migration_records` + 1 `upsert quickbooks_migration_local_links` |
| `source_link_verification` | `assertQuickBooksRecordLinked` — `migration-store.ts:88` | 1 `select quickbooks_migration_records …&source_id=eq.<id>` + 1 `select quickbooks_migration_local_links …&local_id=eq.<uuid>` |
| `accounting_materialization` | `materializeQuickBooksAccounting('vendors')` | **0** — no `CONFIG['vendors']`, returns at `accounting-materializer.ts:87-88` |
| `accounting_verification` | `assertQuickBooksAccountingCompleted('vendors')` | **0** — no config, returns at `:78` |

⇒ **~7–10 sequential round-trips per vendor**, of which **~5–7 are writes**
(`databaseWrites ≈ 713` for the observed 100-record page ⇒ ~7 writes/record; consistent).

For an **extended / ledger** module (`qb-employees`, `invoices`, `bills`,
`journal-entries`, `qb-inventory-adjustments`, …) add
`materializeQuickBooksAccounting()`'s own sequence
(`accounting-materializer.ts:86-138`):

1. `select quickbooks_materialization_runs` (existing)
2. `upsert … status:'posting', attempt_count+1`
3. (if `config.post` & `requiresLedger`) `update … validation:{stage:'native_posting'}`
4. `config.post(...)` — the native ledger posting, itself several reads + inserts into
   `ledger_entries` / `journal_lines` / document tables
5. `update … validation:{stage:'ledger_verification'}`
6. `select ledger_entries` (+ `select stock_movements` if `checksInventory`)
7. (if unbalanced) `select <document table>`
8. `update … status:'completed'`

⇒ **6–12 additional calls per record**, nearly all fixed-signature upserts/updates on
`quickbooks_materialization_runs` (the `?…&source_id=eq.<id>&module_key=eq.<m>` *update*
filters vary per record → those particular ones are unique; but the *upserts* at steps 2
and the manual-required path use body payloads and a fixed `on_conflict` → fixed
signature).

### Transactions

**None.** Every call is an independent PostgREST HTTP request with its own implicit
autocommit. There is no `BEGIN/COMMIT`, no advisory lock, no `SELECT … FOR UPDATE` in the
migration path. A record that fails mid-way is *partially* materialized and cleaned up
best-effort via `module.rollbackCreatedRecord` (`import-processor.ts:196`).

### Retries inside materialization

- No per-record retry loop.
- A **failed record** does **not** retry the batch — it is caught
  (`import-processor.ts:194-209`), counted in `failedCount`, appended to `errors`, and the
  loop continues to the next record.
- A record that threw and is re-seen on a later page (re-extraction) will re-run
  materialization from scratch and bump `quickbooks_materialization_runs.attempt_count`
  again.

### "Stuck at materialization"

`currentStage` in the snapshot is whatever stage the trace was in at the last `emitEvent`.
The route wraps the whole record loop in `trace.measure('materialization', …)`, and
`mergeProgressSnapshot` keeps `next.currentStage ?? prior.currentStage`
(`progress-merge.ts:80`). Between pages the persisted snapshot therefore keeps
`currentStage: 'materialization'` for the entire multi-page module → the UI shows
"Vendors · materialization" for ~50 minutes even though each page also does extraction,
validation and dedup.

### DB-time measurement

`databaseTimeMs` (`migration-telemetry.ts:192`) sums `event.durationMs` for `kind === 'supabase'`
requests, where `durationMs` is measured in `diagnosticFetch` from immediately before
`globalThis.fetch(...)` to the response (`external-request-diagnostics.ts:97-102`). It is
**pure HTTP request latency** — connection + PostgREST + RLS + query + serialization +
network. It is **not** connection-pool acquisition (supabase-js is stateless HTTP; there
is no client-side pool) and **not** Postgres lock wait. Server-side pool exhaustion at the
**PgBouncer/Supavisor pooler** is possible in principle but would show as elevated latency
on *all* signatures uniformly and, more tellingly, as `pg_stat_activity` saturation —
which your diagnostics did not show.

---

## 7. Database Operation Analysis

Observed for a single VENDORS step (~100 records processed):

```
databaseQueries : 1,344      → ~13.4 calls / record
databaseWrites  :   713      → ~7.1  writes / record
databaseTimeMs  : 562,789    → ~419 ms / call, ~5.6 s / record
activeProcessingMs (module, cumulative) : 1,502,705  (~25 min over all vendor pages)
```

### Where the ~13 calls/record come from

| Bucket | Calls/record | Signature stability |
|---|---|---|
| `quickbooks_migration_records` upsert ×2 (archive + link-archive) | 2 | **fixed** ⇒ feeds retryCount |
| `quickbooks_migration_local_links` upsert | 1 | **fixed** |
| native `vendors` insert | 1 | **fixed** |
| document-sequence allocation (`VEND-`) | 1–3 | **fixed** (prefix + type constant) |
| `assertQuickBooksRecordLinked` selects ×2 | 2 | varies (`source_id`, `local_id`) ⇒ *not* retryCount |
| misc fixed-signature writes (audit / settings reads / etc.) | 2–4 | mostly fixed |

Plus per-**step** (not per record):

| Bucket | Calls/step | Notes |
|---|---|---|
| `setImportJobStatus` at start | 2 | `getImportJob` SELECT * + UPDATE |
| progress writes via `onEvent` | ~24–30 | **`getImportJob` does `SELECT *`** (pulls `progress_snapshot`, `activity_events`, `payload_snapshot`) **+ `UPDATE … RETURNING`**, fired on **every** trace event: `stage_started`/`stage_completed` for 6 stages (12) + `batch_completed` (1) + more. All fixed-signature ⇒ ~24–28 added to retryCount. |
| queue `heartbeatJob` PATCH | ~16 | every 30 s during an ~8-min step, fixed signature within one attempt |
| `updateJobProgress(jobId, 10, …)` | 1 | `workers.ts:40` |
| extraction: checkpoint select, staging upsert (100 rows, 1 call), QB API page, OAuth/connection lookup | ~4–6 | |
| `detectDuplicates` → `findDuplicatesBatch` | 2 | **but the 2nd query is `SELECT id,email,tax_id,name FROM vendors WHERE company_id=… AND deleted_at IS NULL` with NO limit** (`vendor.repository.supabase.ts:171-176`) — a full-tenant vendor scan that grows every page (mild O(n²) across pages) |
| `sourcePage.commit()` checkpoint upsert | 1 | |

### N+1 / repeated-work hot spots

1. **Progress persistence is O(trace events), each = `SELECT *` + `UPDATE` on a fat JSONB
   row.** ~25 events/step × 2 calls. The `SELECT *` re-reads the entire
   `progress_snapshot` + up to 100 `activity_events` + `payload_snapshot` every time
   (`import-job.service.ts:104-117`, `getImportJob`).
2. **`archiveQuickBooksRecord` is called twice per record** (`source_archive` with no
   `localId`, then `source_link_archive` with `localId`) — two upserts of nearly the same
   row (`import-processor.ts:139` then `:185`/`:169`).
3. **Dedup full-table scan per page** (item above).
4. **Extended modules:** `quickbooks_materialization_runs` gets 3–5 state-transition
   writes per record (`posting` → `native_posting` → `ledger_verification` → `completed`),
   each a separate HTTP round-trip.
5. **Re-extraction of trailing records** at each page boundary if the checkpoint window
   overlaps (needs confirmation, §19).

### Is 1,344 calls for 100 records plausible from the code? 

Yes. ~10–11 record-level calls + ~35 step-level calls, ×100 ≈ 1,035–1,135, and the
extended-module and sequence paths (or a 2–3-call sequence allocator) close the gap to
~1,344 comfortably. Nothing here indicates a runaway loop — it indicates a **chatty,
un-batched, per-record synchronous design**.

---

## 8. Worker / Queue Analysis

- **Single worker, concurrency 1.** `worker/index.ts` loops `processJobBatch(1, …)`; one
  job at a time; `sleep(IMPORT_WORKER_POLL_MS ?? 2000)` only when nothing was claimed.
- **Heartbeats are healthy** — `worker_heartbeats` updated every
  `WORKER_HEARTBEAT_MS ?? 30_000` from an independent `setInterval`
  (`worker/index.ts` + `src/lib/platform/worker-heartbeat`). The job-queue lease is also
  refreshed every `HEARTBEAT_INTERVAL_MS` from `processJob` (`workers.ts:61`). Your
  observed heartbeat ages (~3–25 s) are exactly one heartbeat interval — normal.
- **Stale-job recovery** (`claimNextJob`, `queue.ts:46-50`): `RUNNING` rows older than
  `STALE_JOB_TIMEOUT_MS = max(90s, JOB_QUEUE_STALE_MS ?? 300s) = 300 s` are forced back to
  `PENDING`. A step that runs > 5 min **without the queue heartbeat landing** would be
  reclaimed and `attempts` bumped — but the 30 s lease heartbeat normally prevents this.
- **Page-to-page scheduling gap** (§5): 0–30 s of idle per page, courtesy of the 30 s
  `recoverOrphanedContinuations` cadence being the only working "next page" trigger.
- **Queue starvation:** not observed. `Queue wait: 0` in your UI snapshots.

---

## 9. UI Metric Calculation Analysis

All computed in `src/lib/import-export/wizard/migration-timing.ts` →
`deriveMigrationTiming()`, surfaced by `migration-center-view.ts:281-318`.

| UI label | Source | Exact meaning | Failure mode |
|---|---|---|---|
| **Elapsed** | `elapsedMs = endMs − startedMs` (`migration-timing.ts:376`) | wall clock since `config.startedAt` | — |
| **Active processing** | `Σ moduleActiveMs` (`:377`); per module = `progressSnapshot.activeProcessingMs` = `initialActiveProcessingMs + (performance.now() − trace.startedAt)` accumulated across steps (`migration-telemetry.ts:188-189`, seeded at `route.ts:584`) | wall time inside worker steps | Includes time the step spent **waiting on sequential HTTP** — which is most of it. Not CPU. |
| **Database wait** | `databaseWaitMs = timing.databaseTimeMs = Σ modules progressSnapshot.databaseTimeMs` (`:379`, `migration-center-view.ts:284`) | **sum of Supabase HTTP request durations** measured by `diagnosticFetch` | **Not lock wait, not pool wait.** A big value with zero blocking locks is the *expected* signature of "many sequential round-trips". |
| **Queue wait** | `Σ moduleQueueWaitMs` (`:378`) = `claimedAt − queuedAt` per module | time a job sat `PENDING` before first claim | Only counts the *first* claim per module; page-boundary recovery gaps land in **idle**, not here. |
| **Waiting / idle** | `idleMs = max(0, elapsedMs − activeProcessingMs)` (`:383`) | everything not inside a worker step | Absorbs: the 0–30 s page-boundary recovery gaps, the 2 s poll sleeps, orchestration, cross-module scheduling, post-finish hang. |
| **Average speed** | `deriveCompletedThroughput` (`:144-159`) = `completedRecords / (completedActiveMs / 1000)` over **fully completed modules only** | records per second of active worker time | Denominator is active-step time, so it directly reflects the ~3–5 s/record cost ⇒ 0.2–0.4 rps. |
| **ETA** | `remainingRecords / completedThroughput` (`:392-394`); `remainingRecords = Σ (moduleRecords − moduleProcessed)` over not-done modules, `moduleRecords = progress.totalRows ?? estimate.records ?? 0` (`:71-78`, `:161-170`) | — | **Systematically optimistic**: modules not yet started with no `estimate.records` contribute **0** to `remainingRecords`. Also `moduleRecords` for an in-flight module uses `progress.totalRows`, which is the `Math.max`-merged running estimate — often a **lower bound**. |
| **retryCount** (per module card) | `snapshot.retryCount` verbatim (`migration-center-view.ts:309`) | §3.4 | Mislabeled; it is "repeated identical outbound requests". |
| **Imported / Updated / Failed** | `maxNumber`-merged counters from `mergeImportJobProgress` (`progress-merge.ts:118-121`) fed by `processImport`'s running totals | monotonic per module | Because the handler passes `base.* + result.*` where `base` = prior persisted counts, re-processing the same source rows on a later page (if dedup misses) would inflate these. The vendor "586" warrants a checkpoint check (§19). |
| **progressPercent** | `computeProgressPercent(processed, total, prev, terminal)` (`progress-merge.ts:53-59`) — clamped to **99.99** until terminal | — | Combined with the `+1` sentinel (`route.ts:343`: `persistedTotal = max(totalRows, checkpoint.fetched + (hasMore ? 1 : 0))`), an in-flight module shows **"N / N+1 · 1 remaining · 99.99%"** indefinitely. **This is the "always 1 record remaining" artifact — it is a deliberate non-terminal sentinel, not a stuck record.** |

---

## 10. Why `qb-employees` can reach retryCount ≈ 1,029

- `qb-employees` **is** in `CONFIG` (`accounting-materializer.ts:27`), so every record runs
  the full `materializeQuickBooksAccounting` sequence: `select` existing +
  `upsert status:'posting'` + (`requiresLedger` is false for employees, so it skips the
  `config.post` branch) + `update validation:{stage:'ledger_verification'}` +
  `select ledger_entries` (skipped, `requiresLedger` false) + `update status:'completed'`
  ≈ **3–4 writes to `quickbooks_materialization_runs` per record**, the `upsert` ones
  fixed-signature.
- Plus the standard per-record set: 2× `quickbooks_migration_records` upsert, 1×
  `quickbooks_migration_local_links` upsert, 1× native `employees` insert, sequence
  allocation.
- 116 employees × (~2 + 1 + 1 + 1 + ~2 fixed-signature materialization upserts) ≈ **116 ×
  7 ≈ 812 repeats**, + ~28 progress-write repeats + ~16 heartbeat repeats + sequence
  repeats ⇒ **~1,000–1,050**. Matches 1,029.
- `failedNetworkCalls` can still be 0 because none of these failed — they were just
  repeats of the same URL.

## 11. Why `qb-tax-agencies` can reach retryCount ≈ 51

- Only **2 records**, single step, no pagination — so no per-record avalanche.
- The 51 is almost entirely **step-level fixed-signature repeats**:
  - progress writes: ~12 trace events × (`getImportJob` `SELECT *` + `UPDATE`) → ~24 calls,
    2 distinct signatures ⇒ **+22**
  - `setImportJobStatus` start: `getImportJob` + `UPDATE` ⇒ collides with the above
    signatures ⇒ **+2**
  - `quickbooks_migration_records` upsert ×2/record × 2 records = 4, 1 sig ⇒ **+3**
  - `quickbooks_migration_local_links` upsert × 2 ⇒ **+1**
  - native `tax_agencies` insert × 2 ⇒ **+1**
  - `quickbooks_materialization_runs` upserts (`qb-tax-agencies` is in CONFIG) ~2–3 × 2 ⇒ **+4–6**
  - queue heartbeat PATCH (short step, maybe 1–2) ⇒ **+0–1**
  - sequence allocation × 2 ⇒ **+1–3**
- Total ≈ **35–58**. Matches 51.
- **Takeaway:** even a 2-record module shows ~50 "retries" purely from progress
  persistence + upserts. The metric is dominated by *fixed overhead per step*, not by
  record-level failures.

## 12. Why `vendors` can reach retryCount ≈ 1,128

- Per record (create path): 2× `quickbooks_migration_records` upsert, 1×
  `quickbooks_migration_local_links` upsert, 1× native `vendors` insert, 1–3× sequence
  allocation, ~2 other fixed-signature writes ⇒ **~7–9 fixed-signature calls/record**.
- 100 records × ~8 ⇒ **~700–800 repeats**.
- Step-level fixed-signature repeats: ~24–28 (progress) + ~16 (queue heartbeat) + a few
  (status, extraction, checkpoint) ⇒ **~45–55**.
- Extended/edge writes + a multi-call sequence allocator + any per-record audit write push
  it to **~1,050–1,200**.
- Merge keeps the **max** across all 6 vendor pages ⇒ the displayed 1,128 is the single
  worst page.
- Again, `failedNetworkCalls = 0` — all repeats, no failures.

## 13. Why `failedNetworkCalls` can be 0 while retryCount is in the thousands

Both come from `MigrationTrace`'s `requests` aggregates (`migration-telemetry.ts:59-67`):

```ts
retryCount          = Σ max(0, item.calls - 1)          // snapshot()  :206
failedNetworkCalls  = Σ item.failedCalls                // finish()    :238
```

- `item.calls` increments on **every** `onRequest` (`:170`).
- `item.failedCalls` increments **only** when `event.status === null || event.status >= 400`
  (`:173`).
- A successful `upsert` sent 200 times: `calls = 200`, `failedCalls = 0` ⇒ contributes
  **+199** to `retryCount` and **+0** to `failedNetworkCalls`.

They measure orthogonal things: *repetition* vs *failure*.

---

## 14. Root Cause(s)

**RC-1 — "retryCount" is a mislabeled repetition metric.**
`progress_snapshot.retryCount` = "number of outbound HTTP requests that repeated an earlier
request's exact method+URL+query, summed over the step". PostgREST writes (`insert`,
`upsert`) all share one signature per (table, on_conflict, select), so the per-record
materialization writes and the per-event progress-persistence `SELECT *`/`UPDATE` on
`import_jobs` generate hundreds-to-thousands of "repeats" in a normal, healthy run. It is
not a retry count, not a failure count, not `import_jobs.retry_count`. The high values
(51 / 927 / 1029 / 1128) are **expected artifacts of the current implementation**, not a
malfunction. (`migration-telemetry.ts:206`, `external-request-diagnostics.ts:81-87`.)

**RC-2 — the migration is slow because it is a per-record, single-threaded, un-batched
chain of synchronous HTTP round-trips.**
~8–14 Supabase REST calls per record, executed strictly sequentially, at ~200–450 ms each
(worker↔pooler↔PostgREST↔RLS↔Postgres), ⇒ ~3–5 s/record ⇒ 0.2–0.4 rows/sec. "Database
wait" is the sum of those latencies; there is no lock contention because there are no
long transactions and no explicit locks.
(`import-processor.ts:106-210`, `migration-store.ts`, `accounting-materializer.ts`,
`external-request-diagnostics.ts:97-102`.)

**RC-3 — page-to-page continuation has no working in-band trigger; it relies on a 30 s
recovery poll.**
`enqueueQuickBooksContinuationOnce()` always fails the `23505` guard (current queue row
still `RUNNING`), and `advanceQuickBooksMigrationAfterImportJob()` refuses non-terminal
jobs. Only `recoverOrphanedContinuations()` (30 s timer) enqueues the next page ⇒ mean
~15 s dead time per page boundary ⇒ the "waiting / idle" minutes.
(`route.ts:44-88, 372-373`; `workers.ts:120-148`; `continuation-scheduler.ts:58-119`;
`migration-session.service.ts:725-749`.)

---

## 15. Contributing Factors

1. **Progress persistence is absurdly chatty and heavy.** `onEvent` fires on every
   `stage_started`/`stage_completed`/`batch_completed`; each does `getImportJob` (`SELECT *`,
   pulling the whole `progress_snapshot` + `activity_events` + `payload_snapshot`) then a
   full-row `UPDATE`. ~25–30 such round-trips per step, on the critical path.
   (`route.ts:585-623`, `import-job.service.ts:200-332`.)
2. **`archiveQuickBooksRecord` runs twice per record**, upserting nearly the same row.
   (`import-processor.ts:139` + `:169`/`:185`.)
3. **Dedup does a full-tenant table scan per page** (`SELECT id,email,tax_id,name FROM
   vendors WHERE company_id=… AND deleted_at IS NULL`, no `LIMIT`), growing each page.
   (`vendor.repository.supabase.ts:171-176`.) Similar patterns likely in other module
   repos.
4. **Extended modules** issue 3–5 `quickbooks_materialization_runs` state-transition writes
   per record, each a separate HTTP call. (`accounting-materializer.ts:104-132`.)
5. **`SELECT *` everywhere** — `getImportJob`, `archiveQuickBooksRecord(...).select('*')`,
   repo `create(...).select('*')` — inflates `databaseTimeMs`.
6. **Document-sequence allocation per record** (`resolveSequenceRepository().next(...)`) —
   likely 2–3 round-trips and a serialization point.
7. **Worker/DB network distance.** ~419 ms average per call is high for PostgREST;
   co-locating the worker with the Supabase region would roughly halve every number in
   §7. (Verify worker region vs project region.)
8. **`currentStage` sticks at `materialization`** across pages (`progress-merge.ts:80`),
   making a working module look hung.
9. **The `+1` total sentinel** (`route.ts:343`) renders as a permanent "1 record
   remaining / 99.99%".
10. **`estimatedTotalRecords` is a `Math.max` lower bound** (`migration-telemetry.ts:150,
    159, 180`), so totals and ETA understate reality until extraction finishes.

---

## 16. Things That Are NOT the Root Cause

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Dead / crashed worker | **Not it** | `worker_heartbeats` age ≈ one interval; `job.claimed`/`handler_completed` flowing. |
| PostgreSQL blocking locks | **Not it** | Blocking-lock join returned 0 rows; migration path uses **no** explicit transactions or locks; "database wait" is HTTP latency, not `pg` wait events. |
| QuickBooks API throttling / failures | **Not it** | `failedNetworkCalls = 0`; QB calls are 1 bounded page (100) per step; `apiTimeMs` is a small fraction of `databaseTimeMs`. |
| HTTP-level retries in `diagnosticFetch` | **Not it** | Would require `failedCalls > 0` (429/5xx); `failedNetworkCalls = 0`. |
| `import_jobs.retry_count` growing | **Not it** | It's `0`; only a human "Retry" moves it. |
| Continuation recovery creating **duplicate concurrent** work | **Not it** | `job_queue_one_active_quickbooks_step_idx` unique partial index forbids it; recovery logs show `created: 0` while a step is active. |
| A runaway `while`/`for` loop incrementing a counter | **Not it** | No such loop exists; `retryCount` is a pure `reduce` over request aggregates computed at snapshot time; `withRetry` is unused. |
| Queue starvation | **Not it** | `Queue wait: 0`. |
| Connection-pool exhaustion (client side) | **Not it** | supabase-js is stateless HTTP; no client pool. (Server-side pooler saturation is *unconfirmed* but unsupported by `pg_stat_activity`.) |
| Materialization retrying the same record forever | **Not it** | Failed records are counted and skipped, not retried, within a step. Re-extraction across pages can re-touch a record but is bounded by pagination. |

---

## 17. Evidence Chain

1. `migration-telemetry.ts:206` — `retryCount = Σ max(0, calls − 1)` over `this.requests`.
2. `migration-telemetry.ts:167-176` — `request` keys aggregates by `${kind}:${signature}`,
   increments `calls` per outbound request, `failedCalls` only on status null/≥400.
3. `external-request-diagnostics.ts:81-87` — `signature` = hash of
   `METHOD host path ?sorted-query`; **body excluded** ⇒ all `upsert`s to a table collapse.
4. `admin.ts:13` / `server.ts:12` — both Supabase clients route through `diagnosticFetch`
   ⇒ every PostgREST call is counted.
5. `route.ts:524-527, 632-645` — `handleImport` / `runImportJobStep` wrap execution in
   `withExternalRequestDiagnostics({ onRequest: trace.request })`.
6. `route.ts:585-623` — `onEvent` → `progressWrites.enqueue(updateImportJobProgress(...))`,
   fired from `emitEvent` on every stage/batch event; **these writes run inside the same
   diagnostics context and are themselves counted** (compounding the metric).
7. `import-job.service.ts:210, 284-291` — `updateImportJobProgress` = `getImportJob`
   (`SELECT *`) + full-row `UPDATE`, per event.
8. `import-processor.ts:106-210` — sequential per-record loop; `archive` ×2;
   `materializeQuickBooksAccounting` + verify.
9. `migration-store.ts:58, 66` — per-record `upsert quickbooks_migration_records` +
   `upsert quickbooks_migration_local_links` (fixed signatures).
10. `accounting-materializer.ts:87-88` — `vendors`/`customers`/`accounts` have no `CONFIG`
    ⇒ materialization is a no-op for them (so their retryCount is "only" ~900–1,130, from
    archive + link + insert + progress).
11. `accounting-materializer.ts:104-132` — extended modules do 3–5 fixed-signature
    `quickbooks_materialization_runs` writes/record ⇒ `qb-employees` ≈ 1,029.
12. `queue.ts:71` — `job_queue.attempts++` on claim (a *different* counter).
13. `import-job.service.ts:357-364` + `migration-session.service.ts:956` — the *only*
    `import_jobs.retry_count` writer, user-triggered.
14. `route.ts:44-88` — in-handler continuation enqueue always hits `23505` (current row
    RUNNING).
15. `workers.ts:120-148` + `migration-session.service.ts:725-749` — post-step coordination
    refuses non-terminal jobs.
16. `worker/index.ts` + `continuation-scheduler.ts:58-119` — 30 s
    `recoverOrphanedContinuations` is the de-facto next-page scheduler; matches
    `recovered_created` → `job.claimed` log ordering.
17. `progress-merge.ts:95` — `retryCount: maxNumber(prior, next)` ⇒ displayed value is the
    running max, not a sum.
18. `migration-timing.ts:379, 383` + `migration-center-view.ts:284` — "Database wait" =
    Σ Supabase request durations; "idle" = elapsed − active.
19. `route.ts:343` — `+1` total sentinel ⇒ "1 record remaining" forever until terminal.

---

## 18. Recommended Fix Direction (RECOMMENDATIONS ONLY — do not implement yet)

### A. Stop calling it "retryCount"
- Rename the snapshot field / UI label to `repeatedRequestCount` (or split into
  `duplicateWriteCount` + `httpRetryCount`), or drop it from the primary UI and keep it in
  a diagnostics panel. Optionally compute a *real* retry figure from
  `Σ failedCalls` + `Σ (job_queue.attempts − 1)` + `import_jobs.retry_count`.
- Exclude the progress-persistence signatures (`import_jobs` SELECT/UPDATE) and the queue
  heartbeat from whatever repetition metric you keep — they are pure instrumentation
  noise.

### B. Cut the per-record round-trip count (biggest performance lever)
- **Batch the materializer.** Process a page's 100 records with set-based operations:
  one multi-row `upsert` into `quickbooks_migration_records`, one into
  `quickbooks_migration_local_links`, one multi-row `insert` into the native table,
  batch dependency resolution (one `IN (...)` query), batch link verification.
- **Collapse the double `archive()` per record** into a single upsert that includes
  `local_id` once the native id is known.
- **Move materialization into Postgres RPCs** (`plpgsql` functions / `rpc()`), one call
  per record or per batch, so the ledger posting + verification happen in a single
  round-trip inside one transaction.
- **`SELECT` only needed columns** (`getImportJob` for progress needs ~6 columns, not
  `SELECT *` with `payload_snapshot`).

### C. Make progress persistence cheap and rare
- Debounce/throttle `onEvent` writes (e.g. at most one write per N seconds or per batch),
  not one per stage transition.
- Persist a slim progress row; keep the fat `progress_snapshot` / `activity_events` in a
  side table or write them only on batch boundaries and finalize.
- Don't re-`SELECT` the whole job before every progress `UPDATE` — do a conditional
  `UPDATE ... WHERE` with `GREATEST(...)` expressions server-side.

### D. Fix page-to-page scheduling
- Enqueue the next continuation **after** `completeJob()` flips the current row (e.g. in
  `completeJob`, or in `coordinateQuickBooksMigrationAfterStep` for a non-terminal job),
  instead of relying on `recoverOrphanedContinuations`.
- Alternatively, exclude the current `platformJobId` from the `23505` guard / active-row
  check so the in-handler enqueue can succeed.
- Keep `recoverOrphanedContinuations` as a *safety net* but drop its cadence's role on the
  happy path; consider `minAgeMs` well above a normal step time to avoid false positives.

### E. Parallelism
- Run 2–4 workers, or process records within a page with bounded concurrency
  (e.g. `p-limit(5)`) once operations are idempotent/independent — dependency-ordered
  modules (`accounts`) excepted.

### F. Co-locate worker and database
- Ensure the QuickBooks worker container runs in the **same region** as the Supabase
  project. At ~419 ms/call this alone likely halves total runtime.

### G. UI honesty
- Replace the `+1` sentinel with an explicit `has_more` boolean so the UI can show
  "page 3 of ~6, extracting more" instead of "1 record remaining, 99.99%".
- Track `currentStage` per step rather than carrying `materialization` forward across
  pages.
- Make ETA count not-yet-started modules using their preview estimates, or label ETA
  "lower bound".

### H. Inventory Adjustments failure (separate issue — do not conflate)
- `source_link_verification: QuickBooks InventoryAdjustment 48 was preserved but did not
  complete native materialization` comes from `assertQuickBooksRecordLinked`
  (`migration-store.ts:94`): the `quickbooks_migration_records` row for that source id has
  no `local_id` / `local_table` / `imported_at`. Investigate the
  `qb-inventory-adjustments` module's `createRecord` + `archive(localId)` path
  independently.

---

## 19. What to Measure After a Fix

1. **Turn on operation profiling.** Set `QUICKBOOKS_PERFORMANCE_MODE=true` (or
   `DEBUG=quickbooks`) — this enables `MigrationTrace.measureOperation` and makes
   `finish()` log `operations`, `slowestOperations` (top 20 with % of step time) and
   `repeatedRequests` (`migration-telemetry.ts:85, 133-144, 231-249`). Compare
   before/after.
2. **Per-record round-trip count:** `databaseQueries / processed_rows` for a page. Target:
   < 3 (from ~13).
3. **Per-call latency:** `databaseTimeMs / databaseQueries`. If still ~400 ms, the
   worker/DB are not co-located — fix that first.
4. **Throughput:** `deriveCompletedThroughput` — target ≥ 5–10 rows/sec.
5. **Page-boundary idle:** time between `handler_completed` and the next `job.claimed` for
   the same `importJobId`. Target: < 3 s (from ~15 s).
6. **`recovered_created` frequency:** should drop to ~0 on the happy path (only real
   crash recovery).
7. **`retryCount` / `repeatedRequestCount`:** after batching writes, per-page value should
   fall by ~1 order of magnitude (the remaining repeats being intentional multi-row
   upserts counted once).
8. **Checkpoint sanity for the "586 vs 301" question:** dump
   `quickbooks_migration_checkpoints` (`next_start_position`, `extracted_count`,
   `status`) and `import_job_skips` for the vendors job across all its pages; confirm
   `next_start_position` advances monotonically and `imported_count` ≈ distinct source ids
   (no double-counting from re-extraction).
9. **`quickbooks_materialization_runs.attempt_count` distribution:** `SELECT
   module_key, max(attempt_count), avg(attempt_count) FROM quickbooks_materialization_runs
   GROUP BY module_key`. `max` should be 1 in a clean run; > 1 means records are being
   re-materialized across pages.
10. **DB round-trip vs wall time ratio per step:** `databaseTimeMs / activeProcessingMs` —
    currently ~0.35–0.55; if it stays high after batching, look at QB extraction or CPU
    (validation) next.
