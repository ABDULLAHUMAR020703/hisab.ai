<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agentic handoff — Financebook / QuickBooks Migration

Use this file when continuing work on `feature/quickbooks-oauth` or anything under Migration Center / QuickBooks import.

## Current branch state (2026-08-06)

| Item | Value |
|---|---|
| Branch | `feature/quickbooks-oauth` |
| Tip | `47b5fd3` — graceful cancel, timing/ETA, activity timeline |
| Prior | `d75217e` — polling owner, coordination loop, poll payload, queue health |
| Remote | Pushed to `origin/feature/quickbooks-oauth` |

**Done and shipped on this branch**

- Persistent Migration Center + Migration History
- Single polling owner (`MigrationSessionProvider`)
- Event-driven coordination (no session-identity refresh loop)
- Compact poll payloads + activity deltas
- Queue health / worker-offline warnings
- Graceful cancel (finish active batch, cancel not-started, resume after cancel)
- Elapsed / Active Processing / ETA (`Estimating...` until completed throughput exists)
- Live activity timeline projected from existing job events (no new event system)

**Do not commit these local leftovers** (noise / scratch):

- CRLF-only or unrelated dirty files under `src/app/api/import-export/**` routes, `api-helpers.ts`, `tax/engine.ts`, registry/mapper helpers
- `.codex-work/`, `head-lock.json`, `head-package.json`, `supabase/.temp/`
- `test-data/quickbooks-sandbox-*.json`, `test-data/performance-results.json`
- `last_5_prompts.md` (session notes only)

## Non-negotiable constraints

Unless the user explicitly expands scope:

1. **Do not redesign** queue architecture, continuation jobs, worker ownership, or DB schema.
2. **Do not add** a new event/telemetry bus — project UI from persisted `import_jobs` + session config.
3. **Preserve** resumability, cumulative progress, completed-job immutability, and single-worker ownership.
4. Prefer **pure projectors** (`migration-*-*.ts`) + thin React wiring over logic inside components.
5. Migration Center / History / Wizard / Indicator must **consume context only** — only `MigrationSessionProvider` polls.

## Runtime map

```
Wizard (config) → create session + import jobs + queue jobs
       ↓
Worker claims queue job → executes module batch → persists progress/events
       ↓
Continuation queue job (same importJobId) until module done
       ↓
MigrationSessionProvider (sole poller) → hydrate/merge → context
       ↓
Migration Center / Global Indicator / History (read-only consumers)
```

Soft cancel path:

```
User Cancel → confirm copy → session CANCELLED
  → cancel not-started modules + non-processing jobs
  → leave active processing job alone (finish current batch)
  → import route gates stop next continuation enqueue/claim
  → Resume re-queues cancelled modules; completed work kept
```

## Key files

| Area | Path |
|---|---|
| Session model | `src/lib/import-export/wizard/migration-session.ts` |
| Session CRUD / cancel / poll | `src/lib/import-export/wizard/migration-session.service.ts` |
| Module cards / phases | `src/lib/import-export/wizard/module-lifecycle.ts` |
| Center view model | `src/lib/import-export/wizard/migration-center-view.ts` |
| Cancel planner | `src/lib/import-export/wizard/migration-cancel.ts` |
| Timing / ETA | `src/lib/import-export/wizard/migration-timing.ts` |
| Activity timeline | `src/lib/import-export/wizard/migration-activity-timeline.ts` |
| Coordination decisions | `src/lib/import-export/wizard/migration-coordination.ts` |
| Poll envelope / deltas | `src/lib/import-export/wizard/migration-poll-payload.ts` |
| Queue health | `src/lib/import-export/wizard/migration-queue-health.ts` |
| Navigation latch | `src/lib/import-export/wizard/migration-navigation.ts` |
| Progress merge | `src/lib/import-export/jobs/progress-merge.ts` |
| Telemetry / active ms | `src/lib/import-export/quickbooks/migration-telemetry.ts` |
| Import + cancel gates | `src/app/api/import-export/[module]/import/route.ts` |
| Sole poller UI | `src/components/import-export/MigrationSessionProvider.tsx` |
| Center UI | `src/components/import-export/MigrationCenter.tsx` |
| Center page | `src/app/(dashboard)/migration-center/[sessionId]/page.tsx` |
| History page | `src/app/(dashboard)/migration-history/page.tsx` |
| Worker entry | `worker/index.ts` (`npm run worker`) |

## Invariants to protect

- Progress counters are **cumulative** across continuation pages; never regress.
- `import_jobs.status = completed` is **immutable** (ignore late progress writes).
- One worker owns an `importJobId` at a time (ownership / attempt checks).
- While multi-page: import job stays `processing` (do not bounce to `pending` on continuation enqueue).
- Coordination runs on **events** (new session, module complete/fail, retry, resume) — not every React session object identity change.
- Cancel confirm copy must remain:  
  `The current module will finish its active batch before stopping. Completed modules will remain available.`
- ETA uses **completed-module throughput only**; otherwise show `Estimating...`.
- Timeline is a **pure function** of persisted events + job timestamps; historical reopen must match live.

## Known optional follow-ups (not required unless asked)

- `pausedAccumulatedMs` / pause–resume wall-clock accounting refinement for Active Processing Time
- Broader cleanup of CRLF-only dirty files on the working tree
- Sandbox end-to-end re-run + report refresh under `test-data/` (keep out of commits unless requested)

## How to validate

Node’s built-in test runner via `tsx --test` (see `package.json` scripts).

Focused Migration Center suites:

```powershell
npx tsx --test `
  tests/integrations/quickbooks-migration-cancel.test.ts `
  tests/integrations/quickbooks-migration-timing.test.ts `
  tests/integrations/quickbooks-migration-activity-timeline.test.ts `
  tests/integrations/quickbooks-migration-center.test.ts `
  tests/integrations/quickbooks-migration-coordination-loop.test.ts `
  tests/integrations/quickbooks-poll-payload.test.ts `
  tests/integrations/quickbooks-queue-health.test.ts `
  tests/integrations/quickbooks-single-polling-owner.test.ts `
  tests/integrations/quickbooks-view-progress-navigation.test.ts `
  tests/integrations/quickbooks-global-migration-indicator.test.ts
```

Also useful: `npm run test:quickbooks-validation`, `npm run worker` for live queue processing.

After edits: prefer targeted tests + `tsc`/eslint on touched files over full-suite unless asked. Full suite historically has a couple of pre-existing failures unrelated to Migration Center.

## Git / PowerShell notes

- Commit only when the user asks. Do not force-push.
- On Windows PowerShell, use a here-string for commit messages (`@" ... "@`), not bash HEREDOC.
- Prefer staging explicit migration paths; never blanket-add the dirty tree.
- Remote may print a moved-repo notice (`Techdotglobal/hisab.ai`); `origin` push still works for this branch.

## Session notes

`last_5_prompts.md` summarizes the last cancel / timing / timeline asks. Treat it as historical notes — prefer this `AGENTS.md` + git history as source of truth for current shipped state.
