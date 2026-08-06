import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Migration Center restore paints a skeleton instead of a blocking spinner-only screen', () => {
  const page = read('src/app/(dashboard)/migration-center/[sessionId]/page.tsx')
  const center = read('src/components/import-export/MigrationCenter.tsx')

  assert.match(center, /export function MigrationCenterSkeleton/)
  assert.match(page, /MigrationCenterSkeleton/)
  assert.match(page, /canPaintCachedMigrationSession/)
  assert.doesNotMatch(page, /animate-spin/)
  assert.doesNotMatch(page, /fetch\(/)
})

test('provider defers interval polling until after the first hydrate', () => {
  const provider = read('src/components/import-export/MigrationSessionProvider.tsx')

  assert.equal(provider.match(/window\.setInterval\(/g)?.length, 1)
  assert.match(provider, /void refresh\(\)\.then\(\(\) => \{/)
  assert.match(provider, /timer = window\.setInterval\(/)
  assert.match(provider, /activity', '0'/)
  assert.match(provider, /shouldDeferActivityOnRestore/)
  assert.match(provider, /canPaintCachedMigrationSession/)
})

test('poll APIs accept activity=0 to slim the first restore payload', () => {
  const byId = read('src/app/api/import-export/migration-sessions/[sessionId]/route.ts')
  const list = read('src/app/api/import-export/migration-sessions/route.ts')
  const service = read('src/lib/import-export/wizard/migration-session.service.ts')

  assert.match(byId, /activity'\) !== '0'/)
  assert.match(list, /activity'\) !== '0'/)
  assert.match(service, /includeActivityEvents/)
  assert.match(service, /shouldIncludeQueueHealthOnHydrate/)
})

test('import job poll select omits activity_events when deferred', () => {
  const jobs = read('src/lib/import-export/jobs/import-job.service.ts')
  assert.match(jobs, /includeActivityEvents/)
  assert.match(jobs, /IMPORT_JOB_POLL_COLUMNS/)
  assert.match(jobs, /\$\{IMPORT_JOB_POLL_COLUMNS\},activity_events/)
})
