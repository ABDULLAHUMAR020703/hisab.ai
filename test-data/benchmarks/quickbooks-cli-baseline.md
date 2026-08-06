# QuickBooks CLI migration baseline

Measured 2026-08-06 against the connected QuickBooks **sandbox** realm `9341457612363747`
(`QB_ENVIRONMENT=sandbox`), tenant `00000000-0000-4000-8000-000000000001`, from a local
Windows dev machine. Raw JSON for every run is in `test-data/benchmarks/`.

Reproduce with:

```powershell
npx tsx -r dotenv/config -r ./scripts/zatca/setup-server-only.cjs `
  scripts/quickbooks/benchmark-module.ts --module=customers --strategy=update [--report]
```

## Part 1 — CLI entrypoints

| Entrypoint | Scope | Queue | Import processor |
|---|---|---|---|
| `scripts/quickbooks/run-live-sandbox-migration.ts` | Whole company in dependency order; `--modules=a,b` narrows it; `--smoke` runs one pass instead of two | Bypassed — no HTTP route, no `job_queue`, no `import_jobs` | Same `processImport` as the worker |
| `scripts/quickbooks/benchmark-module.ts` (added for this task) | Exactly one module | Bypassed | Same `processImport` as the worker |
| `worker/index.ts` (`npm run worker`) | One queue step per claim, continuation-chained | Queue-driven (`QUICKBOOKS_IMPORT_STEP` → `runImportJobStep`) | Same `processImport` |
| `scripts/quickbooks/inspect-live-*.ts`, `inspect-native-links.ts` | Read-only inspectors over checkpoints, jobs, materialization runs | n/a | None |

Both CLI paths share the extraction and persistence internals with the worker
(`fetchWithCheckpoint`, staging, checkpoints, `detectDuplicates`, `processImport`), but the
orchestration differs and that difference must be held in mind for later comparisons:

- CLI calls `fetchSourceResource`, which paginates the whole module in one process, then runs
  one `processImport` over every row.
- The worker calls `fetchSourceResourcePage` with `maxBatches: 1` and `batchSize: 100`, so each
  queue step handles one page and enqueues a continuation.
- The worker additionally maintains `import_jobs`, writes a progress snapshot per batch, persists
  skips and errors, and calls `isCancelled` / `isPaused` / `assertActive` **per row**. The CLI
  passes none of these callbacks, so its progress-persistence cost is zero by construction.

## Part 2 — Single module benchmark

Module: **Customers** (`--strategy=update`), three runs.

| Run | Duration | Rows | Imported | Updated | Skipped | Failed | Rows/sec |
|---|---|---|---|---|---|---|---|
| 1 (cold, token refresh) | 62.49 s | 26 | 0 | 26 | 0 | 0 | 0.42 |
| 2 (warm) | 58.01 s | 26 | 0 | 26 | 0 | 0 | 0.45 |
| 3 (warm, with report) | 61.53 s | 26 | 0 | 26 | 0 | 0 | 0.42 |

QuickBooks returned 29 `Customer` records; the adapter normalized 26 rows. All 26 validated and
all 26 matched existing records, so every row took the update path. Run-to-run spread is 7%.

Second module for scale confirmation: **Chart of Accounts**, 90 rows, 189.65 s, 0.47 rows/sec,
90 updated, 0 failed.

## Part 3 — Stage timing (Customers, run 1)

| Stage | Duration | % of total |
|---|---|---|
| Authentication (connection lookup + OAuth token refresh) | 3,594 ms | 5.75% |
| QuickBooks API request | 2,636 ms | 4.22% |
| Pagination / staging writes (4 calls) | 1,168 ms | 1.87% |
| Checkpoint commit (3 calls) | 766 ms | 1.23% |
| Fetch stage total | 8,201 ms | 13.12% |
| Mapping (`coerceMappedRows`) | 1 ms | 0.00% |
| Validation (`validateMappedRows`) | 13 ms | 0.02% |
| Duplicate detection (`detectDuplicates`, 1 batch query) | 274 ms | 0.44% |
| Materialization + insert/update (`processImport`) | 53,996 ms | 86.41% |
| — of which Supabase round trips (234 calls) | 53,705 ms | 85.95% |
| — of which CPU / everything else | 291 ms | 0.47% |
| Progress persistence | 0 ms | 0.00% (CLI passes no `onProgress`) |
| Report generation (`buildQuickBooksMigrationReport`, run 3) | 1,062 ms | 1.73% |
| Finalization (`trace.finish`) | 1 ms | 0.00% |

Warm runs move roughly 2.4 s from authentication into nothing: run 3 spent 687 ms on connection
lookup with no token refresh, and its fetch stage was 5,053 ms.

Inside `processImport`, the per-record operation profile (from `QUICKBOOKS_PERFORMANCE_MODE`) is:

| Operation | Calls | Avg | Total | % of module |
|---|---|---|---|---|
| `source_link_archive` | 26 | 695 ms | 18,064 ms | 33.3% |
| `native_update` | 26 | 463 ms | 12,039 ms | 22.2% |
| `source_archive` | 26 | 461 ms | 11,981 ms | 22.1% |
| `source_link_verification` | 26 | 458 ms | 11,904 ms | 21.9% |
| `dependency_validation` | 26 | 0.10 ms | 2.6 ms | 0.005% |
| `accounting_materialization` | 26 | 0.05 ms | 1.2 ms | 0.002% |
| `accounting_verification` | 26 | 0.01 ms | 0.2 ms | 0.0004% |

## Part 4 — API analysis

| Endpoint | Entity | Calls | Response time | Rows | Avg rows/call | Payload | Total API time |
|---|---|---|---|---|---|---|---|
| `sandbox-quickbooks.api.intuit.com/v3/company/{realm}/query` | Customer | 1 | 2,636 ms | 29 | 29 | 30,417 B | 2,636 ms |
| `oauth.platform.intuit.com` (token refresh) | — | 1 (run 1 only) | 2,354 ms | — | — | — | 2,354 ms |

Chart of Accounts was also a single query call: 2,408 ms for 90 rows.

- Slowest endpoint / highest latency: the OAuth token refresh at 2,354 ms, then the entity query
  at ~2.4–2.6 s regardless of whether it returns 29 or 90 rows.
- Largest payload: 30.4 KB (Customer query).
- Highest request count: one query per module — QuickBooks is not the bottleneck at this size.

The database is the real request-count story. Supabase calls, Customers run 1:

| Table | Calls | Avg | Total |
|---|---|---|---|
| `quickbooks_migration_records` | 78 | 231 ms | 18,002 ms |
| `customers` | 53 | 231 ms | 12,236 ms |
| `company_currencies` | 52 | 229 ms | 11,933 ms |
| `quickbooks_migration_local_links` | 52 | 227 ms | 11,804 ms |
| everything else (staging, checkpoints, connection, providers, logs) | 14 | ~270 ms | 3,996 ms |
| **Total** | **249** | **233 ms** | **57,971 ms** |

Chart of Accounts scaled identically: 823 calls for 90 rows (9.1 per row) at 225–228 ms each.

A control measurement of 12 sequential trivial Supabase REST calls from the same machine gives
min 224 ms, median 229 ms, mean 243 ms. Per-call time inside the import is indistinguishable from
that floor, so the database is doing no meaningful work — the cost is purely the round trip.

## Part 5 — Throughput baseline

| Phase | Customers (26 rows) | Accounts (90 rows) |
|---|---|---|
| Fetch | 3.2–5.4 rows/sec | 18.1 rows/sec |
| Mapping | ~37,000–41,000 rows/sec | ~71,000 rows/sec |
| Validation | ~1,700–2,000 rows/sec | ~5,100 rows/sec |
| Persistence | 0.48 rows/sec | 0.49 rows/sec |
| **Total module** | **0.42–0.45 rows/sec** | **0.47 rows/sec** |

Persistence throughput is flat at ~0.48 rows/sec across both modules, which is what makes this a
usable baseline: it is `1 / (9 round trips × ~230 ms)`.

## Observations

- Fetch, mapping, and validation are free. Mapping and validation together are under 20 ms for a
  module; extraction is one API call. Nothing in the read path needs optimization at this scale.
- 86–97% of wall time is `processImport`, and 99.5% of that is waiting on sequential Supabase
  round trips. CPU inside the processor is ~300 ms per module.
- The engine issues about **9 sequential database round trips per record** and never batches or
  parallelizes them: archive, link archive, link verification, currency lookup, and the entity
  update each cost a full round trip.
- `company_currencies` is queried twice per record (52 calls for 26 rows) and returns tenant-level
  data that cannot change mid-module. This is the clearest pure-waste lookup.
- `quickbooks_migration_records` is hit three times per record (78 calls for 26 rows).
- Absolute rows/sec here is latency-bound and machine-specific. A worker co-located with the
  database will post better numbers without any code being faster. The portable baseline is
  **round trips per record (9.1) and CPU per module (~300 ms)**, not the 0.45 rows/sec.

## Potential bottlenecks, in priority order

1. **Per-record sequential round trips.** Batching archive/link writes per batch, or running the
   independent lookups for a record concurrently, attacks 86% of runtime directly.
2. **Redundant tenant-scoped lookups.** Caching `company_currencies` per module run removes ~2
   round trips per record (~21% of Customers runtime) with no behavioral change.
3. **Repeated `quickbooks_migration_records` reads.** Three round trips per record where the
   archive and link paths appear to re-read the same row.
4. **Worker-only overhead not present in this baseline.** `processImport` calls `isCancelled`,
   `isPaused`, and `assertActive` per row, and the route persists a progress snapshot per batch.
   None of that executes in the CLI, so the worker should be expected to be *slower* than this
   baseline; measuring by how much is the next step.
5. **OAuth token refresh (2.4 s)** is once per process. It is negligible for a whole-company CLI
   run but is paid on every worker step that starts with an expired token, so it will show up
   disproportionately in the queue-driven comparison.

## Instrumentation notes

No application code was changed. Timing comes from hooks that already exist:
`SourceFetchDiagnostics.onStage`, `MigrationTrace` (including `measureOperation`, gated by the
pre-existing `QUICKBOOKS_PERFORMANCE_MODE` env flag), and a `globalThis.fetch` wrapper installed
by the benchmark script inside its own process only. Body inspection used for payload size and
rows-per-request is timed separately and excluded from stage durations; it totalled 16 ms per run.
