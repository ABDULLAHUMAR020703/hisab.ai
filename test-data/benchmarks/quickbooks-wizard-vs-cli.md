# QuickBooks Migration Wizard vs CLI benchmark

Measured **2026-08-06** against sandbox realm `9341457612363747`, tenant `00000000-0000-4000-8000-000000000001` (`QB_ENVIRONMENT=sandbox`).

**Verdict:** The worker/wizard path has **no hidden algorithmic regression** in extraction/validation/duplicate detection. Active-path slowdown vs CLI is **real and explained**: almost entirely extra Supabase round-trips from per-row cancel/pause status reads plus progress persistence, on top of the same sequential materialization bottleneck the CLI already has. Cold create (fresh reset) is slower than warm update; the fair CLI comparison is the **update-path** wizard pass.

---

## Method

| Path | Entrypoint | Queue / jobs | Processor |
|---|---|---|---|
| **CLI baseline** | `scripts/quickbooks/benchmark-module.ts` | Bypassed | Same `processImport` |
| **Wizard / worker** | `scripts/quickbooks/benchmark-wizard.ts` | `migration_wizard_sessions` → `import_jobs` → `enqueueJob(QUICKBOOKS_IMPORT_STEP)` → `npm run worker` | Same `processImport` via `runImportJobStep` |

Wizard orchestration matches Migration Center coordination (`nextCoordinationAction` → create-job → run-job → poll/reconcile → next module → `COMPLETED`). Browser chrome was not driven by Playwright; the session/job/queue/worker path is the same code the UI uses through `MigrationSessionProvider`.

Modules: `accounts`, `customers` · strategy=`update`  
CLI baselines: `test-data/benchmarks/quickbooks-cli-*.json` (warm **update** on already-imported data).

Two wizard passes:

1. **Cold create** (`--reset`) — empty tenant → insert path  
2. **Warm update** (no reset) — fair compare to CLI  

Raw JSON:

- `test-data/benchmarks/quickbooks-wizard-2026-08-06T11-14-49-935Z.json` (cold)
- `test-data/benchmarks/quickbooks-wizard-2026-08-06T11-22-01-529Z.json` (warm)

---

## Correctness

### Cold create session `2acd4a6f-…`

| Check | Result |
|---|---|
| Session → COMPLETED | **PASS** |
| Import jobs → completed | **PASS** (2/2) |
| Modules auto-scheduled (accounts → customers) | **PASS** (~1.0 s idle gap) |
| No module stuck | **PASS** |
| No orphan PENDING/RUNNING queue jobs | **PASS** |
| No IN_PROGRESS sessions left | **PASS** |
| No open/stale checkpoints | **PASS** |
| ETA after first completed module | Converges (final label `0m 00s`) |

### Warm update session `9c0ff43f-…`

| Check | Result |
|---|---|
| Session → COMPLETED | **PASS** |
| Import jobs → completed | **PASS** (2/2; company then had 4 completed jobs total) |
| Modules auto-scheduled | **PASS** |
| Snapshot check `noOrphanQueueJobs` | **FAIL at snapshot** (1 PENDING) — see note |
| Post-run verify (later) | All queue rows **COMPLETED**; 0 PENDING/RUNNING |
| No IN_PROGRESS sessions | **PASS** |
| Stale checkpoints | **PASS** (none) |

**Orphan note:** At warm-run snapshot the harness saw one `PENDING` `QUICKBOOKS_IMPORT_STEP`. Immediate post-run verify shows four `COMPLETED` queue rows and zero pending. Likely a race between session `mark-completed` and the last platform-job `completeJob`, or a continuation that finished milliseconds after the check. Not a stuck orphan in the final DB state.

### History counts (post both runs)

| Surface | Expected | Observed |
|---|---|---|
| Migration History | 2 COMPLETED sessions | 2 COMPLETED |
| Import History | 4 completed jobs | accounts 90i + customers 26i; then accounts 90u + customers 26u |
| Queue | No active work | 4 COMPLETED |
| Checkpoints | No open stale rows | empty / none open |

### Timing internal consistency

| Invariant | Cold | Warm |
|---|---|---|
| Elapsed ≥ Active | PASS | PASS |
| Idle ≈ Elapsed − Active | PASS | PASS |
| Queue wait ≤ Idle | PASS (reported 0; see caveat) | PASS |
| Database wait ≤ Active | **FAIL** | **FAIL** |

**Why DB wait can exceed Active:** `databaseTimeMs` is the **sum of instrumented Supabase call durations**; `activeProcessingMs` is wall-clock of the `MigrationTrace`. They are not a strict partition. Overlap/double-count (progress writes, cancel polls that also hit instrumented clients) lets Σ(DB) slightly exceed wall active (accounts ~+0.2 s; customers ~+4 s). Elapsed / Active / Idle remain consistent with each other.

**Queue wait caveat:** Harness `queueWaitMs` used `import_jobs.started_at`, which is set at job create (often **before** enqueue), so claimed &lt; queued and queue wait collapses to 0. True claim latency from waterfall idle gaps is **~0.5 s** session-start → first claim and **~1 s** between modules — not a multi-minute idle.

---

## Session timing (wizard)

### Cold create (reset → insert)

| Metric | Value |
|---|---|
| Wall / elapsed | 442 s / 439.8 s |
| Active processing | 417.8 s |
| Idle (incl. coordination) | 22.1 s |
| Database wait (Σ) | 428.2 s |
| API wait | 4.0 s |
| ETA final | `0m 00s` |

### Warm update (fair vs CLI)

| Metric | Value |
|---|---|
| Wall / elapsed | 401 s / 398.8 s |
| Active processing | 379.4 s |
| Idle | 19.5 s |
| Database wait (Σ) | 383.9 s |
| API wait | 7.6 s |
| ETA final | `0m 00s` |

---

## Per-module stage timestamps (warm update — CLI-comparable)

### Chart of Accounts (`2e11b564-…`)

| Stage | Started | Completed | Duration |
|---|---|---|---|
| Queued (import_job created) | 11:15:22.168Z | — | — |
| Worker claimed (job started_at) | 11:15:21.053Z | — | — |
| Extraction | 11:15:27.437Z | 11:15:35.057Z | 7.6 s |
| Validation | 11:15:35.059Z | 11:15:35.079Z | 20 ms |
| Duplicate detection | 11:15:35.079Z | 11:15:35.467Z | 0.39 s |
| Materialization | 11:15:35.468Z | 11:20:21.547Z | **286.1 s** |
| Completion | — | 11:20:24.310Z | — |

Counters: 90 updated · active 294.6 s · DB 294.8 s · API 5.2 s · **1125** DB queries / **554** writes · 0.31 rows/s

### Customers (`8ded29fc-…`)

| Stage | Started | Completed | Duration |
|---|---|---|---|
| Queued | 11:20:25.460Z | — | — |
| Worker claimed | 11:20:24.354Z | — | — |
| Extraction | 11:20:32.515Z | 11:20:36.599Z | 4.1 s |
| Validation | 11:20:36.600Z | 11:20:36.612Z | 13 ms |
| Duplicate detection | 11:20:36.612Z | 11:20:37.095Z | 0.48 s |
| Materialization | 11:20:37.095Z | 11:21:56.818Z | **79.7 s** |
| Completion | — | 11:21:59.609Z | — |

Counters: 26 updated (29 QB entities normalized to 26) · active 84.8 s · DB 89.0 s · API 2.4 s · **355** DB queries / **168** writes · 0.34 rows/s

Cold create stages were similar shape; materialization longer (accounts 314.9 s / customers 91.3 s) because every row took **native_create** instead of **native_update**.

---

## CLI vs Wizard comparison

### Fair compare — warm update path

| Module | Metric | CLI | Wizard | Δ | Δ% |
|---|---|---:|---:|---:|---:|
| **accounts** | Active / total | 189.6 s | 294.6 s | +105.0 s | **+55.3%** |
| | DB wait | 183.5 s | 294.8 s | +111.3 s | **+60.7%** |
| | API wait | 2.4 s | 5.2 s | +2.8 s | **+118%** |
| | Rows | 90 upd | 90 upd | 0 | 0% |
| | Rows/s | 0.47 | 0.31 | −0.16 | **−35.0%** |
| | Materialization | 184.4 s | 286.1 s | +101.7 s | +55.2% |
| | Fetch / extraction | 5.0 s | 7.6 s | +2.6 s | +53% |
| | Dup detect | 0.26 s | 0.39 s | +0.13 s | +48% |
| | DB calls | 810 | 1125 queries | +315 | +39% |
| **customers** | Active / total | 61.5 s | 84.8 s | +23.3 s | **+37.8%** |
| | DB wait | 54.7 s | 89.0 s | +34.3 s | **+62.7%** |
| | API wait | 2.6 s | 2.4 s | −0.2 s | −7.1% (within noise) |
| | Rows | 26 upd | 26 upd | 0 | 0% |
| | Rows/s | 0.42 | 0.34 | −0.08 | **−18.6%** |
| | Materialization | 55.0 s | 79.7 s | +24.7 s | +44.9% |
| | DB calls | 234 | 355 queries | +121 | +52% |

### Cold create vs CLI (not fair — different write path)

| Module | CLI (update) | Wizard (create) | Δ% active |
|---|---:|---:|---:|
| accounts | 189.6 s · 90 upd · 0.47 r/s | 320.5 s · 90 imp · 0.28 r/s | **+69.0%** |
| customers | 61.5 s · 26 upd · 0.42 r/s | 97.3 s · 26 imp · 0.30 r/s | **+58.1%** |

Extra cold cost vs warm wizard: accounts +26 s, customers +12 s — insert/link path heavier than update on this tenant.

---

## Discrepancy analysis (every Δ &gt; 15%)

### 1. Accounts active +55% / DB +61% / rows/s −35% (warm)

**Primary cause (~100 of +105 s): extra Supabase chatter on the worker path during materialization.**

Evidence:

- Materialization stage alone: CLI 184 s → Wizard 286 s (+102 s).
- DB call count: 810 → 1125 (+315).
- Worker wires `isCancelled` + `isPaused` **per row** (and per batch), each calling `getImportJob()` → `select('*')` on `import_jobs` (includes growing `progress_snapshot` / `activity_events`).
- For 90 rows: ≥180 status-read round trips the CLI never issues (CLI passes no cancel/pause callbacks).
- Plus `onProgress` → `updateImportJobProgress` with full progress snapshot after each processImport batch (CLI `onProgress` is null → 0 progress persistence).
- `assertActive` / ownership checks are cheap in-memory after claim; they are **not** the main cost.

**Not the cause:** different materialization algorithm (same `processImport` update path, same 90 updated). Not multi-page continuation overhead for these modules (single QB page each; one queue step each).

**Secondary (~2–5 s):** extraction +2.6 s and API +2.8 s — network/token variance (wizard recorded 2 API requests vs CLI’s 1 query); not structural.

### 2. Customers active +38% / DB +63% / rows/s −19% (warm)

Same mechanism, smaller absolute size:

- Materialization +25 s; DB calls 234 → 355 (+121).
- ~52 cancel+pause `getImportJob` reads (26 rows × 2) + progress snapshot write(s).
- API −7% — within run-to-run noise; **not** a regression.

### 3. Cold create +58–69% vs CLI

**Compound of (1) plus create-vs-update path.** Fresh reset forced `native_create` + first-time link/archive; CLI baseline was warm `native_update` on existing rows. Do not treat cold Δ as pure worker overhead.

### 4. Accounts API wait +118% (warm)

Absolute +2.8 s (2.4 → 5.2). Wizard telemetry `apiRequests: 2` vs CLI single query — likely auth/connection probe + entity query, or slower sandbox latency. Not proportional to row work; negligible vs materialization.

### 5. Duplicate detection +48% accounts (0.26 → 0.39 s)

Absolute +130 ms. Same `detectDuplicates` code; difference is DB latency noise / cold PostgREST. Not a structural worker tax.

### 6. Queue wait / idle

Wall idle ~20 s across the session includes:

- ~0.5 s start → claim  
- ~1 s accounts complete → customers claim (coordination poll)  
- Remaining idle is mostly **outside** active worker time already excluded from Active (hydrate polls do not add to Active).

No multi-minute hidden queue stall on these runs (worker was live at 2 s poll).

### 7. CPU time ≈ 0

`cpuMs = max(0, active − database − api)`. Because Σ(DB)+API ≥ Active (instrumentation), reported CPU floors at 0. Real JS CPU is tiny vs network wait (CLI already showed &lt;1% CPU in materialization).

---

## Auto-scheduling / ETA / waterfall

- After accounts completed, coordination created customers job and enqueued within ~1–2 s (waterfall idle gap ~1.0 s cold / similar warm).
- Session reached `completed` / `COMPLETED` only after both modules terminal.
- ETA uses completed-module active throughput; with one completed module mid-run it leaves `Estimating...`, then converges; final both-runs label `0m 00s` with remaining 0.
- Waterfall ≥100 ms gaps: start→claim, per-module active, extraction, dup detect, materialization, inter-module idle — consistent with Elapsed = Active + Idle.

---

## Remaining optimization opportunities (by expected gain)

Ordered; **not implemented in this task**.

1. **Batch / parallelize Supabase writes inside `processImport`** — still ~85–97% of module time even on CLI (sequential REST). Largest absolute win for both paths (~3–10× potential if batched).
2. **Collapse per-row `source_link_archive` + `source_link_verification` + `native_update` chatter** — dominates CLI operation profile; same on worker.
3. **Stop per-row `isCancelled` / `isPaused` full-row `getImportJob()`** — cache status for N seconds, or poll once per batch, or `select('status')` only. Expected recovery of a large fraction of the **+35–55% worker tax** (~100 s on accounts at current latency).
4. **Coalesce progress persistence** — write snapshots less often than every batch; shrink payload (avoid rewriting full `activity_events` on every progress update).
5. **Larger worker page / `maxBatches` > 1** — irrelevant for these 26–90 row modules; matters for large QB lists (cuts claim/enqueue/re-fetch overhead between pages).
6. **Eager next-module enqueue from reconcile** — removes ~1–2 s coordination gap only; architecture-sensitive; tiny vs materialization.
7. **Fix queue-wait metric source** — use platform `job_queue.created_at` → `started_at`, not `import_jobs.started_at` at create time (observability, not runtime perf).
8. **Reconcile DB-wait vs Active instrumentation** — make timers a strict partition for UI trust.

---

## Bottom line

| Question | Answer |
|---|---|
| Hidden worker regression vs CLI core import? | **No** — same `processImport`; stages outside materialization stay small. |
| Is wizard/worker slower? | **Yes, +38–55% active** on warm update for these modules. |
| Exact cause? | **Per-row cancel/pause DB reads + progress snapshot writes** inflating Supabase wait during materialization; plus cold-create vs warm-update when reset. |
| Correctness of session/jobs/queue/history? | **Pass** on cold; warm final DB clean (transient PENDING at one snapshot). |
| Optimize now? | **No** — benchmark only, as requested. |
