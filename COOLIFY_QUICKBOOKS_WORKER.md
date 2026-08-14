# Coolify QuickBooks worker

Deploy the worker as a separate Coolify application. Do not point the Coolify
application at the frontend `Dockerfile`; the frontend remains deployed by
Vercel.

## Coolify settings

| Setting | Value |
| --- | --- |
| Repository | `Techdotglobal/hisab.ai` |
| Branch | `feature/quickbooks-oauth` |
| Build pack | Dockerfile |
| Dockerfile location | `/Dockerfile.worker` |
| Port | none |
| Start command | image default (`npm run worker`) |
| Replicas | 1 initially; increase only with the same Supabase queue and idempotency guarantees |
| Restart policy | Always |

## Required environment variables

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
QB_CLIENT_ID=
QB_CLIENT_SECRET=
QB_REDIRECT_URI=
QB_ENVIRONMENT=production
IMPORT_WORKER_POLL_MS=2000
# Queue ownership/abandonment protection
JOB_QUEUE_HEARTBEAT_MS=30000
JOB_QUEUE_STALE_MS=300000
```

Use the same `QB_ENVIRONMENT` (and matching Intuit app credentials) on the web
app and this worker. Production migrations require `QB_ENVIRONMENT=production`
plus a connection that was authorized against QuickBooks Production. Use
`QB_ENVIRONMENT=sandbox` only for local/dev workers.

## Runtime behavior

The worker claims only `QUICKBOOKS_IMPORT_STEP` rows from `job_queue` using the
existing atomic claim operation. Each claim runs one bounded extraction/import
unit through the existing resumable state machine, commits the QuickBooks
checkpoint after successful posting, and allows the next queue row to be
claimed. Running jobs refresh their queue ownership heartbeat. Stale `RUNNING`
queue rows are returned to `PENDING` after `JOB_QUEUE_STALE_MS` for crash and
redeploy recovery; the attempt number prevents an abandoned worker from
overwriting a reclaimed attempt.

No Vercel Cron, Next.js HTTP worker route, or frontend process is required for
continued migration processing. The frontend continues to create import jobs,
enqueue the first unit through the existing start endpoint, and poll
`/api/import-export/jobs/{jobId}` for progress.
