import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findExistingProject,
  projectImportMatchKey,
  skuFromProductFields,
} from '../../src/lib/cost-centers/import/project-upsert'
import { extractProductCost } from '../../src/lib/cost-centers/product-catalog'
import { buildProductServiceMetadata } from '../../src/lib/cost-centers/product-catalog'

describe('project/service upsert matching', () => {
  it('prefers SKU over name for the match key', () => {
    assert.deepEqual(projectImportMatchKey({ name: 'Spanner', sku: 'SKU-001' }), {
      kind: 'sku',
      key: 'sku:sku-001',
    })
    assert.deepEqual(projectImportMatchKey({ name: 'Spanner', sku: '' }), {
      kind: 'name',
      key: 'name:spanner',
    })
  })

  it('matches existing projects by SKU first, then by name', () => {
    const existing = [
      {
        id: '1',
        name: '12PCS SPANNER SET',
        metadata: buildProductServiceMetadata({
          'Product/Service Name': '12PCS SPANNER SET',
          SKU: 'SKU-001',
          Cost: '100',
        }),
      },
      {
        id: '2',
        name: 'FIRST AID KIT',
        metadata: { Cost: '50' },
      },
    ]

    const bySku = findExistingProject(existing, {
      name: 'Renamed Spanner',
      sku: 'SKU-001',
    })
    assert.equal(bySku?.id, '1')

    const byName = findExistingProject(existing, {
      name: 'first aid kit',
      sku: null,
    })
    assert.equal(byName?.id, '2')

    const missing = findExistingProject(existing, {
      name: 'ALLEN KEY SET',
      sku: 'SKU-999',
    })
    assert.equal(missing, null)
  })

  it('reads SKU from product fields and keeps updated cost in metadata', () => {
    assert.equal(skuFromProductFields({ SKU: 'SKU-001', 'Product/Service Name': 'X' }), 'SKU-001')
    const updated = buildProductServiceMetadata({
      'Product/Service Name': '12PCS SPANNER SET',
      Cost: '125',
      SKU: 'SKU-001',
    })
    assert.equal(extractProductCost(updated), 125)
  })
})
