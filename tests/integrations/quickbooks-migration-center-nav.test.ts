import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Administration sidebar lists Migration Center between Wizard and History', () => {
  const layout = read('src/app/(dashboard)/layout.tsx')
  const wizard = layout.indexOf("{ label: 'Migration Wizard', href: '/migration-wizard'")
  const center = layout.indexOf("{ label: 'Migration Center', href: '/migration-center'")
  const history = layout.indexOf("{ label: 'Migration History', href: '/migration-history'")

  assert.ok(wizard >= 0, 'Migration Wizard nav item missing')
  assert.ok(center >= 0, 'Migration Center nav item missing')
  assert.ok(history >= 0, 'Migration History nav item missing')
  assert.ok(wizard < center && center < history, 'Migration Center must sit between Wizard and History')
  assert.match(layout, /href: '\/migration-center', icon: Gauge/)
  assert.match(layout, /,\s*Gauge\s*}/)
})

test('Migration Center index resumes the latest session without its own poller', () => {
  const page = read('src/app/(dashboard)/migration-center/page.tsx')

  assert.match(page, /useMigrationSession\(\)/)
  assert.match(page, /openMigrationCenter\(session\.id\)/)
  assert.match(page, /data-migration-center-index/)
  assert.match(page, /label: 'Administration'/)
  assert.match(page, /label: 'Migration Center'/)
  assert.doesNotMatch(page, /setInterval\(/)
  assert.doesNotMatch(page, /fetch\(/)
})

test('session-scoped Migration Center routes keep the sidebar item active via prefix match', () => {
  const layout = read('src/app/(dashboard)/layout.tsx')
  assert.match(layout, /pathname\.startsWith\(href\)/)
  assert.match(layout, /href: '\/migration-center'/)
})
