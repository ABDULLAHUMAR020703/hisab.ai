# Scripts

| Folder | Scripts | npm command |
|--------|---------|-------------|
| `db/` | Prisma generate, migrate, SQLite sync, Supabase apply/verify | `postinstall`, `build`, `supabase:*` |
| `qa/` | QA seed and DB verification | `qa:seed`, `qa:verify` |
| `zatca/` | Sandbox runner, phase 7 verify, server-only hooks | `zatca:sandbox`, `zatca:verify` |

All scripts are invoked via `package.json` — do not run ad-hoc diagnostic scripts in this repo.
