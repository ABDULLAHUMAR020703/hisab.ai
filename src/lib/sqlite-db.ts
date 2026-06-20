import { accessSync, constants, copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import os from 'os'
import path from 'path'

const bundledDbPath = path.join(process.cwd(), 'prisma', 'dev.db')
const tmpDbPath = path.join(os.tmpdir(), 'hisab-ai', 'dev.db')

export function getSqliteDatabaseUrl() {
  const dbPath = resolveConfiguredDbPath()

  // On a genuinely read-only filesystem (e.g. Vercel/AWS Lambda, where only
  // /tmp is writable) SQLite cannot open the bundled database for writes, so we
  // copy it into a writable temp directory and use that instead.
  //
  // IMPORTANT: detect this by *actual writability*, not the VERCEL/NODE_ENV
  // flags. A stray `VERCEL=1` (or production NODE_ENV) on a local dev machine
  // must not redirect to the temp copy — doing so silently serves a stale,
  // never-migrated snapshot of the database.
  if (!isPathWritable(dbPath)) {
    return toFileUrl(prepareTmpDatabase(dbPath))
  }

  return toFileUrl(dbPath)
}

function resolveConfiguredDbPath(): string {
  const configuredUrl = process.env.DATABASE_URL
  if (configuredUrl?.startsWith('file:')) {
    const raw = configuredUrl.slice('file:'.length)
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  }
  return bundledDbPath
}

/**
 * Returns true when SQLite would be able to open `dbPath` for writing: the file
 * itself must be writable when it exists, otherwise its parent directory must be
 * writable so the file can be created.
 */
function isPathWritable(dbPath: string): boolean {
  try {
    if (existsSync(dbPath)) {
      accessSync(dbPath, constants.W_OK)
      return true
    }
    accessSync(path.dirname(dbPath), constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Copy the (read-only) source DB into a writable temp dir, refreshing if stale. */
function prepareTmpDatabase(sourceDbPath: string): string {
  const tmpDir = path.dirname(tmpDbPath)
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  if (existsSync(sourceDbPath)) {
    const sourceNewer =
      !existsSync(tmpDbPath) || statSync(sourceDbPath).mtimeMs > statSync(tmpDbPath).mtimeMs
    if (sourceNewer) {
      copyFileSync(sourceDbPath, tmpDbPath)
    }
  }

  return tmpDbPath
}

/**
 * Build a `file:` URL the better-sqlite3 adapter can parse on every platform.
 * Windows absolute paths use backslashes, which the adapter mangles; the
 * adapter (and SQLite) expect forward slashes in a `file:` URL. Returning an
 * absolute, forward-slash path also makes resolution independent of the
 * process cwd, which the Turbopack dev runtime does not keep at the project
 * root, causing it to silently open a stale/empty database otherwise.
 */
function toFileUrl(absolutePath: string): string {
  return `file:${absolutePath.replace(/\\/g, '/')}`
}
