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
QB_ENVIRONMENT=sandbox
IMPORT_WORKER_POLL_MS=2000
```

Use `QB_ENVIRONMENT=production` only for a production QuickBooks connection.
The worker must have the Supabase service-role key because it claims and
updates tenant-scoped queue/checkpoint rows outside a browser request.

## Runtime behavior

The worker claims only `QUICKBOOKS_IMPORT_STEP` rows from `job_queue` using the
existing atomic claim operation. Each claim runs one bounded extraction/import
unit through the existing resumable state machine, commits the QuickBooks
checkpoint after successful posting, and allows the next queue row to be
claimed. Stale `RUNNING` queue rows are returned to `PENDING` for crash and
redeploy recovery.

No Vercel Cron, Next.js HTTP worker route, or frontend process is required for
continued migration processing. The frontend continues to create import jobs,
enqueue the first unit through the existing start endpoint, and poll
`/api/import-export/jobs/{jobId}` for progress.
