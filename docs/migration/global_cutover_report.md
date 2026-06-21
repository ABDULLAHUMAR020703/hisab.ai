# Supabase Runtime Cutover Report

**Date:** 2025-06-21  
**Status:** Supabase-first runtime enabled

## What changed

- `USE_SUPABASE=true` is now the default runtime mode.
- `src/lib/supabase/env.ts` treats Supabase as enabled unless `USE_SUPABASE=false` is explicitly set.
- `.env.example` documents Prisma/SQLite as rollback only.
- Local `.env` was updated with:
  ```bash
  USE_SUPABASE=true
  DB_PARITY_CHECK=false
  DUAL_WRITE=false
  ```
- `npm run build` no longer runs `scripts/db/prisma-sqlite-sync.mjs`.
- SQLite build remains available via:
  ```bash
  npm run build:sqlite
  npm run db:sqlite-sync
  ```

## Validation

| Check | Result |
| ----- | ------ |
| `npm run build` | PASS |
| TypeScript | PASS |
| Lints on changed runtime files | PASS |

## Important limits

This is **not** full Phase D12 completion. The application is Supabase-first for migrated repository reads, but these areas are still pending:

- D5 write dual-write
- D6 accounting write workflows
- D7 inventory transaction workflows
- D8 payroll writes
- D9–D10 ZATCA service cutover
- D11 Supabase Auth
- Phase E Prisma/SQLite removal

## Rollback

```bash
USE_SUPABASE=false
DB_PARITY_CHECK=false
DUAL_WRITE=false
```

If the rollback build path is needed:

```bash
npm run build:sqlite
```
