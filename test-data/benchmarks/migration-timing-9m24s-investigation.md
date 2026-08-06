# Migration timing investigation — Journal Entries 9m24s

Session: `25aef753-456e-47e2-ba6b-c8b34cd772d5`  
Import job: `557741c7-2da7-47ab-8f6c-3827f7f3ce92`  
Queue job: `656b7c3e-fe6f-43ea-987c-23f4429d3b2a`  
Module: Journal Entries (3 records) · strategy `update`  
Stopwatch / dashboard Elapsed: **9m24s** (confirmed correct)

**Investigation only — timing calculations were not changed.**

---

## Verdict

| Question | Answer |
|---|---|
| Did the backend truly wait ~9 minutes? | **Partially yes.** ~5m01s was a real abandoned RUNNING queue claim until stale recovery. ~3m39s was orchestration delay before a successful worker run. Only **34s** was active import work. |
| Was the worker “busy with other migrations”? | **No evidence.** No other PENDING/RUNNING migrations. The delay was this job’s own attempt-1 abandonment + coordination lag. |
| Is Waiting/Idle (8m49s) “wrong math”? | **Math is consistent** (`elapsed − active`), but the **label is misleading** — it is not “worker idle with nothing to do”; it includes orchestration lag + abandoned claim. |
| Why Queue Wait = 0s while waterfall shows 2m32s? | **Different (and wrong) timestamps.** Queue Wait uses `import_jobs.started_at` set at **job create**, so claim ≤ create → 0. Waterfall “Worker claimed” uses that same early `started_at`, measuring **session start → job create**, not enqueue → claim. |
| Why ~6 minutes missing from waterfall sum? | **Coverage bug.** Active span’s wall interval is `[import_jobs.started_at → updated_at]` (~6m49s) so gap insertion treats that window as “covered”, but the row’s displayed `durationMs` is only **34s** active. Abandoned time disappears from the sum. |

---

## Complete timestamped lifecycle

Sources: `migration_wizard_sessions`, `import_jobs`, `job_queue`, `import_jobs.activity_events`, `progress_snapshot`.

| # | Event | Timestamp (UTC) | Source | Δ previous | From session start |
|---|---|---|---|---:|---:|
| 1 | Migration started | `15:43:25.531Z` | `config.startedAt` | — | 0s |
| 2 | Session row created | `15:43:25.648Z` | `migration_wizard_sessions.created_at` | 0.1s | 0.1s |
| 3 | Import job created (+ `started_at` stamped) | `15:45:58.272Z` / `15:45:57.730Z` | `import_jobs.created_at` / `started_at` | **+2m32.7s** | 2m32.7s |
| 4 | Queue job inserted (PENDING) | `15:47:04.341Z` | `job_queue.created_at` | **+1m06.1s** | 3m38.8s |
| 5 | Attempt 1 claimed then abandoned | ~`15:47:04` → ~`15:52:05` | inferred: `attempts=2`, stale recovery | **~5m01s** | — |
| 6 | Stale recovery → attempt 2 claim | `15:52:05.661Z` | `job_queue.scheduled_at` = `started_at`, `attempts=2` | — | 8m40.1s |
| 7 | Worker trace started | `15:52:09.422Z` | `progress_snapshot.startedAt` | +3.8s | 8m43.9s |
| 8 | Extraction started | `15:52:10.562Z` | activity_events | +1.1s | 8m45.0s |
| 9 | Extraction completed | `15:52:15.337Z` | activity_events | 4.8s | 8m49.8s |
| 10 | Validation | `15:52:15.338–15.342Z` | activity_events | ~4ms | — |
| 11 | Duplicate detection | `15:52:15.342–16.196Z` | activity_events | 0.85s | — |
| 12 | Materialization | `15:52:16.196–43.526Z` | activity_events | 27.3s | — |
| 13 | Import job completed | `15:52:46.188Z` | `import_jobs.completed_at` | +2.7s | 9m20.7s |
| 14 | Session completed | `15:52:49.537Z` | `migration_wizard_sessions.updated_at` | +3.3s | **9m24.0s** |

Evidence of abandoned attempt:

- `job_queue.attempts = 2`
- `job_queue.created_at = 15:47:04` but `started_at` / `scheduled_at` of the surviving claim = `15:52:05`
- Stale recovery in `claimNextJob` resets `scheduled_at` to `now` after `STALE_JOB_TIMEOUT_MS` (default **5 minutes**)

---

## Second-by-second partition of 9m24s (564.0s)

| Interval | Start | End | Duration | Category | Real? |
|---|---|---|---:|---|---|
| Session start → import job created | 15:43:25 | 15:45:58 | **152.7s** | Orchestration / coordination (`create-job` not yet done) | Yes (wall) |
| Import job created → queue enqueued | 15:45:58 | 15:47:04 | **66.1s** | Orchestration (`run-job` / enqueue not yet done) | Yes (wall) |
| Queue attempt 1 abandoned → stale recovery | 15:47:04 | 15:52:05 | **301.3s** | Abandoned RUNNING claim / heartbeat timeout | Yes (wall) |
| Claim attempt 2 → trace start | 15:52:05 | 15:52:09 | **3.8s** | Worker claim / handler startup | Yes |
| Active processing (snap) | 15:52:09 | ~15:52:43 | **34.1s** | Active worker (`activeProcessingMs`) | Yes |
| Trace end → import job completed | ~15:52:43 | 15:52:46 | **~2.7s** | Finalization / persistence | Yes |
| Import job completed → session completed | 15:52:46 | 15:52:49 | **3.3s** | Session reconcile / mark-completed | Yes |
| **Total** | | | **564.0s** | | = Elapsed |

Stage split inside the 34.1s active bucket:

| Stage | Duration |
|---|---:|
| Extraction | 4.8s |
| Validation | ~0.0s |
| Duplicate detection | 0.9s |
| Materialization | 27.3s |
| Scheduling / overhead inside active | ~1.1s |

---

## How Waiting / Idle is calculated

```383:383:src/lib/import-export/wizard/migration-timing.ts
  const idleMs = Math.max(0, elapsedMs - activeProcessingMs)
```

For this session:

- `elapsedMs` = `session.updatedAt − config.startedAt` = 564006ms ≈ 9m24s  
- `activeProcessingMs` = `progress_snapshot.activeProcessingMs` = 34104ms ≈ 34s  
- `idleMs` = 529902ms ≈ **8m49s**

So Waiting/Idle is **not** “measured worker idle”. It is **all wall time that was not counted as active processing**, including:

1. create-job / enqueue coordination lag (~3m39s)
2. abandoned queue attempt (~5m01s)
3. finalization / session reconcile (~6s)

That matches the dashboard card. The backend was not “doing nothing” for 8m49s in the sense of an empty queue — for ~5 minutes a RUNNING queue row was held until stale recovery.

---

## Queue Wait = 0s vs waterfall 2m32s

### Queue Wait card

```102:122:src/lib/import-export/wizard/migration-timing.ts
  const queuedAt = parseInstant(job?.createdAt) ?? … queueJob?.createdAt …
  const claimedAt = parseInstant(job?.startedAt) ?? … queueJob?.startedAt …
  if (claimedAt != null) return Math.max(0, claimedAt - queuedAt)
```

`createImportJob` always sets `started_at` at insert time:

```80:83:src/lib/import-export/jobs/import-job.service.ts
      status: 'processing',
      …
      started_at: now,
```

This session:

- `import_jobs.created_at` = 15:45:58.272  
- `import_jobs.started_at` = 15:45:57.730 (**before** created)  
- Queue Wait = max(0, −0.5s) = **0**

Authoritative queue wait should use **platform queue** timestamps:

- enqueue: `job_queue.created_at` = 15:47:04  
- successful claim: `job_queue.started_at` (attempt 2) = 15:52:05  
- **True queue wait ≈ 5m01s** (or include attempt-1 hold time explicitly as “abandoned claim”)

### Waterfall “Migration started → Worker claimed” 2m32s

“Worker claimed” point uses the same `job.startedAt` (create stamp), so the idle gap is:

`config.startedAt (15:43:25) → import_jobs.started_at (15:45:57)` = **2m32s**

That is **orchestration time until import job row exists**, mislabeled as worker claim.

---

## Why the waterfall only explains ~3 minutes

Displayed spans (approx):

| Span | Shown duration |
|---|---:|
| Idle gap · started → “claimed” | 2m32s |
| Active processing | 0m34s |
| Extraction / dup / materialization (stage rows) | overlap with active |
| Idle gap · module finished → session completed | 0m03s |
| **Sum of primary non-overlapping display** | **~3m09s** |

Missing ≈ **6m15s**.

Mechanism:

```292:307:src/lib/import-export/wizard/migration-timing.ts
    // active span wall = [claimedIso … finishedIso]
    // durationMs = min(activeProcessingMs, wall)
```

```335:341:src/lib/import-export/wizard/migration-timing.ts
    // idle gaps skipped when covered by queue_wait|worker|stage wall interval
```

Here:

- `claimedIso` = early `import_jobs.started_at` (15:45:57)  
- `finishedIso` = `import_jobs.updated_at` (15:52:46)  
- Wall coverage ≈ **6m49s**  
- Displayed `durationMs` = **34s**  

Gap insertion sees points inside that wall as “covered by worker span” → **no idle_gap for the abandoned 5 minutes**. Those seconds never appear as their own row and are not included in the 34s duration → they vanish from the waterfall total.

---

## Worker behavior (proven)

| Check | Finding |
|---|---|
| Other migrations RUNNING/PENDING | Not indicated for this company at investigation time; this queue row alone explains the delay |
| Poll interval | `IMPORT_WORKER_POLL_MS` default 2000ms — not a multi-minute sleep |
| Stale recovery | `STALE_JOB_TIMEOUT_MS` default **5 minutes** — matches the 15:47:04 → 15:52:05 gap |
| Attempts | `2` on the single queue row |
| Active work | Only after attempt 2 (`progress_snapshot.startedAt` 15:52:09) |

Attempt 1 almost certainly claimed soon after enqueue, then lost heartbeats (process hang, crash, network — same class of issue seen earlier with stuck workers). The job stayed RUNNING until stale recovery.

Orchestration lags (2m33s + 1m06s) are separate: historically `MigrationSessionProvider` had to `create-job` then `run-job` after session create. Those gaps were wall-clock real (browser-driven coordination across poll/effect cycles), not worker queue depth.

**Fix (2026-08-07):** `createQuickBooksMigrationSession` now calls `bootstrapQuickBooksMigrationQueue` so the first import job + `job_queue` row are written inside the Migrate POST before the response returns. Provider create-job/run-job remain a fallback for later modules.

---

## Historical contamination

Checked against this session’s own rows only:

- `config.startedAt` / `updated_at` belong to session `25aef753-…`
- Job `557741c7-…` activity events all at 15:52:09–43
- `activeProcessingMs` 34s matches those events
- No evidence prior sessions’ active ms were added

Contamination is **not** the cause of the 8m49s idle. The bug is **wrong claim timestamp + waterfall coverage**, plus **real abandoned attempt**.

---

## Root cause (exact)

1. **Real delay (~5m):** Queue job attempt 1 abandoned; stale recovery (~5 min) before attempt 2.  
2. **Real delay (~3m39s):** Session→create-job→enqueue coordination lag.  
3. **Metric defect — Queue Wait:** Uses `import_jobs.started_at` stamped at create → reports 0.  
4. **Metric defect — Waterfall claim marker:** Same wrong timestamp → “2m32s to claim” is really “2m32s to create import job”.  
5. **Metric defect — Waterfall coverage:** Active span wall uses wrong early start → suppresses ~6m of abandoned/orchestration time from idle gaps while only displaying 34s.

---

## Proper fix (do not apply until approved)

1. **Authoritative Queue Wait** = `job_queue.started_at − job_queue.created_at` for the successful claim (sum per module; if multiple continuation pages, sum each step or use first enqueue→first claim + continuation gaps explicitly). Never use `import_jobs.started_at` from `createImportJob`.  
2. **Stop setting `import_jobs.started_at` at create** (leave null until worker begins), or ignore it for timing when status was reset to `pending`.  
3. **Waterfall “Worker claimed”** = `job_queue.started_at` (attempt that ran work), falling back to `progress_snapshot.startedAt`.  
4. **Active span wall** must start at true worker start (`progress_snapshot.startedAt` / queue started_at), not create-time `import_jobs.started_at`, so coverage matches `durationMs` and abandoned time becomes visible idle/queue spans.  
5. **Waiting/Idle** may remain `elapsed − active`, but UI copy should clarify it includes orchestration + abandoned claims; optionally split: `queueWaitMs`, `orchestrationMs`, `abandonedMs`.  
6. **Invariant:** sum of non-overlapping waterfall buckets (or a dedicated partition) = `elapsedMs` (±1s).  
7. **Regression tests** with this session’s fixture (see `tests/integrations/quickbooks-migration-timing-accounting.test.ts`).

---

## Dashboard vs reality (this run)

| Metric | Dashboard | Reality |
|---|---:|---|
| Elapsed | 9m24s | 9m24s ✓ |
| Active | 34s | 34s ✓ |
| Waiting / Idle | 8m49s | 8m49s wall-not-active ✓ / meaning misleading |
| Queue Wait | 0s | **~5m01s** enqueue→successful claim ✗ |
| Waterfall claim gap | 2m32s “to claim” | Actually session→job create ✗ |
| Waterfall completeness | ~3m shown | **~6m hidden** by coverage bug ✗ |
