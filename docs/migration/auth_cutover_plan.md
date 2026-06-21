# Phase D11 — Auth Cutover Plan

**Status:** Plan only — **do not implement until D4–D10 complete.**

## Current auth (Prisma / SQLite)

| Component | Implementation |
| --------- | -------------- |
| Sessions | Cookie `session` → `AppSession.token` → `User` |
| Login | `POST /api/auth/login` — bcrypt password on `User.passwordHash` |
| Guard | `requireAuth()` in `src/lib/auth.ts` |
| Logout | `AppSession.deleteMany` |
| Roles | `User.role` enum (`ADMIN`, `ACCOUNTANT`, etc.) |

## Target auth (Supabase)

| Component | Target |
| --------- | ------ |
| Sessions | Supabase Auth JWT + `@supabase/ssr` cookie helpers |
| Login | `supabase.auth.signInWithPassword` |
| Guard | Middleware + `createServerClient` session refresh |
| Roles | `company_users.role` per tenant |
| Profiles | `profiles` table linked to `auth.users.id` |

## Migration mapping

| Legacy (Prisma) | Supabase |
| --------------- | -------- |
| `User.id` (cuid) | `profiles.legacy_user_id` + new UUID |
| `User.email` | `auth.users.email` |
| `User.passwordHash` | `auth.users.encrypted_password` (re-hash or force reset) |
| `User.role` | `company_users.role` for default company |
| `AppSession` | Drop — replaced by Supabase refresh tokens |

Phase C import already created auth users with `MIGRATION_USER_PASSWORD`.

## Cutover steps (future)

1. **Dual-read sessions** — validate `getSession()` can resolve user from Supabase profile by legacy ID
2. **Login shadow** — attempt Supabase sign-in after Prisma login succeeds; log mismatches
3. **Feature flag** `USE_SUPABASE_AUTH=false` — separate from `USE_SUPABASE` data flag initially
4. **Middleware** — enable `src/lib/supabase/middleware.ts` session refresh
5. **Route guards** — replace `requireAuth()` internals, keep same export
6. **Disable AppSession** writes when flag on
7. **Force password reset** option for users not in Supabase Auth

## Preserve

- User IDs visible in UI (via `legacy_user_id` lookup)
- Role-based access (`ADMIN` vs `ACCOUNTANT`)
- Company scoping via `company_users`
- All existing API route signatures

## Rollback

```bash
USE_SUPABASE_AUTH=false
USE_SUPABASE=false
```

Prisma `AppSession` + SQLite users remain intact.

## Files to touch (when implementing)

- `src/lib/auth.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/lib/supabase/middleware.ts`
- `middleware.ts` (root)
- `src/lib/db/user.repository.ts` (extend)

**Not in scope for D11 planning phase:** implementation.
