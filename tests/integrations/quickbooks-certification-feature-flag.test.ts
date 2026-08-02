import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isQuickBooksCertificationEnabled,
  quickBooksCertificationDisabledResponse,
} from '../../src/lib/quickbooks-certification/feature'

const read = (path: string) => readFileSync(path, 'utf8')

test('QuickBooks certification defaults to disabled and is restored by one flag', () => {
  assert.equal(isQuickBooksCertificationEnabled(undefined), false)
  assert.equal(isQuickBooksCertificationEnabled('false'), false)
  assert.equal(isQuickBooksCertificationEnabled('TRUE'), true)
})

test('disabled certification routes use a structured HTTP 404 response', async () => {
  const response = quickBooksCertificationDisabledResponse()
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'FEATURE_TEMPORARILY_DISABLED',
      message: 'Feature Temporarily Disabled',
    },
  })
})

test('all certification surfaces and execution entry points are guarded', () => {
  const integrationPage = read('src/app/(dashboard)/settings/integrations/page.tsx')
  const integrationClient = read('src/app/(dashboard)/settings/integrations/integrations-client.tsx')
  const certificationPage = read('src/app/(dashboard)/settings/integrations/quickbooks-certification/page.tsx')
  const route = read('src/app/api/integrations/quickbooks/certification/route.ts')
  const exportRoute = read('src/app/api/integrations/quickbooks/certification/[runId]/export/route.ts')
  const service = read('src/lib/quickbooks-certification/service.ts')
  const runner = read('scripts/quickbooks/run-live-sandbox-migration.ts')

  assert.match(integrationPage, /certificationEnabled={isQuickBooksCertificationEnabled\(\)}/)
  assert.match(integrationClient, /certificationEnabled && item\.status === 'CONNECTED'/)
  assert.match(certificationPage, /if\(!isQuickBooksCertificationEnabled\(\)\)notFound\(\)/)
  for (const handler of ['GET', 'POST', 'PATCH']) {
    assert.match(route, new RegExp(`function ${handler}\\([^}]+isQuickBooksCertificationEnabled`))
  }
  assert.match(exportRoute, /export async function GET[\s\S]*?if\(!isQuickBooksCertificationEnabled\(\)\)/)
  assert.match(service, /runQuickBooksCertification[^}]+assertQuickBooksCertificationEnabled\(\)/)
  assert.match(runner, /if\(isQuickBooksCertificationEnabled\(\)\)/)
})

test('disabled API and service entry points stop before authentication or job execution', async () => {
  const previous = process.env.ENABLE_QUICKBOOKS_CERTIFICATION
  delete process.env.ENABLE_QUICKBOOKS_CERTIFICATION
  try {
    const route = await import('../../src/app/api/integrations/quickbooks/certification/route')
    const exportRoute = await import('../../src/app/api/integrations/quickbooks/certification/[runId]/export/route')
    const service = await import('../../src/lib/quickbooks-certification/service')
    const request = new Request('http://localhost/api/integrations/quickbooks/certification')

    assert.equal((await route.GET(request)).status, 404)
    assert.equal((await route.POST(new Request(request.url, { method: 'POST' }))).status, 404)
    assert.equal((await route.PATCH(new Request(request.url, { method: 'PATCH' }))).status, 404)
    assert.equal((await exportRoute.GET(request, { params: Promise.resolve({ runId: 'run-1' }) })).status, 404)
    await assert.rejects(
      service.runQuickBooksCertification('company-1', 'user-1', {}),
      /temporarily disabled/i,
    )
  } finally {
    if (previous === undefined) delete process.env.ENABLE_QUICKBOOKS_CERTIFICATION
    else process.env.ENABLE_QUICKBOOKS_CERTIFICATION = previous
  }
})

test('migration completion keeps validation, integrity, reports, history, and verification visible', () => {
  const migration = read('src/components/import-export/steps/ConnectedSourceFlow.tsx')
  const report = read('src/lib/import-export/migration-report.ts')
  const history = read('src/lib/import-export/jobs/import-job.service.ts')

  assert.match(migration, /Migration complete/i)
  assert.match(migration, /Imported/)
  assert.match(migration, /Updated/)
  assert.match(migration, /Skipped/)
  assert.match(migration, /Failed/)
  assert.match(migration, /Validation score/)
  assert.match(migration, /Integrity score/)
  assert.doesNotMatch(migration, /certif/i)
  assert.match(report, /validationScore/)
  assert.match(report, /integrityScore/)
  assert.match(history, /processed_rows/)
})

test('certification implementation and existing tests remain present', () => {
  for (const path of [
    'src/lib/quickbooks-certification/service.ts',
    'src/lib/quickbooks-certification/engine.ts',
    'src/lib/quickbooks-certification/quickbooks-reports.ts',
    'src/lib/quickbooks-certification/hisab-reports.ts',
    'src/app/(dashboard)/settings/integrations/quickbooks-certification/certification-client.tsx',
    'tests/integrations/quickbooks-certification.test.ts',
  ]) assert.ok(read(path).length > 0, `${path} must remain present`)
})
