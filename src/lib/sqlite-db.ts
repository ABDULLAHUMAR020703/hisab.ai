import { copyFileSync, existsSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'

const bundledDbPath = path.join(process.cwd(), 'prisma', 'dev.db')
const tmpDbPath = path.join(os.tmpdir(), 'hisab-ai', 'dev.db')

export function getSqliteDatabaseUrl() {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    const tmpDir = path.dirname(tmpDbPath)
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    if (!existsSync(tmpDbPath) && existsSync(bundledDbPath)) {
      copyFileSync(bundledDbPath, tmpDbPath)
    }
    return `file:${tmpDbPath}`
  }

  const configuredUrl = process.env.DATABASE_URL
  if (configuredUrl?.startsWith('file:')) {
    return configuredUrl
  }

  return `file:${bundledDbPath}`
}
