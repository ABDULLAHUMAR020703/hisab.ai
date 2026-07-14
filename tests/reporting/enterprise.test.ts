import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFilters,
  applySorting,
  applyGrouping,
  paginateRows,
  evaluateFormula,
} from '../../src/lib/reporting/builder'
import { resolvePeriod, priorPeriod, monthlyBuckets } from '../../src/lib/reporting/periods'
import { listReportCatalog, getReportCatalogEntry } from '../../src/lib/reporting/registry'
import { ageBucket } from '../../src/lib/reporting/aging-utils'

describe('enterprise reporting framework', () => {
  describe('report builder', () => {
    const rows = [
      { category: 'Sales', amount: 1000, status: 'OPEN' },
      { category: 'Sales', amount: 500, status: 'CLOSED' },
      { category: 'Ops', amount: 200, status: 'OPEN' },
    ]

    it('filters rows by field conditions', () => {
      const filtered = applyFilters(rows, [{ field: 'category', op: 'eq', value: 'Sales' }])
      assert.equal(filtered.length, 2)
    })

    it('sorts rows descending', () => {
      const sorted = applySorting(rows, [{ field: 'amount', direction: 'desc' }])
      assert.equal(sorted[0].amount, 1000)
    })

    it('groups rows by field', () => {
      const grouped = applyGrouping(rows, [{ field: 'category' }])
      assert.equal(grouped.length, 2)
    })

    it('paginates result sets', () => {
      const { rows: paged, pagination } = paginateRows(rows, 1, 2)
      assert.equal(paged.length, 2)
      assert.equal(pagination.total, 3)
      assert.equal(pagination.totalPages, 2)
    })

    it('evaluates simple calculated formulas', () => {
      assert.equal(evaluateFormula('{actual}-{budget}', { actual: 100, budget: 40 }), 60)
    })
  })

  describe('period resolution', () => {
    it('resolves YTD period', () => {
      const { period } = resolvePeriod('ytd')
      assert.ok(period.from)
      assert.ok(period.to)
      assert.equal(period.preset, 'ytd')
    })

    it('resolves custom period', () => {
      const { period } = resolvePeriod('custom', { from: '2026-01-01', to: '2026-03-31' })
      assert.equal(period.from, '2026-01-01')
      assert.equal(period.to, '2026-03-31')
    })

    it('computes prior period', () => {
      const prior = priorPeriod({ from: '2026-04-01', to: '2026-06-30', preset: 'custom' })
      assert.ok(new Date(prior.to) < new Date('2026-04-01'))
    })

    it('builds monthly buckets', () => {
      const buckets = monthlyBuckets(new Date('2026-01-01'), new Date('2026-03-15'))
      assert.equal(buckets.length, 3)
    })
  })

  describe('report catalog', () => {
    it('lists financial reports including legacy keys', () => {
      const financial = listReportCatalog('financial')
      assert.ok(financial.some((r) => r.key === 'profit-loss'))
      assert.ok(financial.some((r) => r.key === 'trial-balance'))
      assert.ok(financial.some((r) => r.key === 'budget-vs-actual'))
    })

    it('includes analytics reports', () => {
      const analytics = listReportCatalog('analytics')
      assert.ok(analytics.some((r) => r.key === 'executive-dashboard'))
      assert.ok(analytics.some((r) => r.key === 'revenue-trends'))
    })

    it('registers operational reports', () => {
      const entry = getReportCatalogEntry('top-customers')
      assert.ok(entry)
      assert.equal(entry?.category, 'operational')
    })
  })

  describe('aging buckets', () => {
    it('maps days past due to standard buckets', () => {
      assert.equal(ageBucket(0), 'current')
      assert.equal(ageBucket(15), '1-30')
      assert.equal(ageBucket(45), '31-60')
      assert.equal(ageBucket(100), '90+')
    })
  })
})
