import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergeProjectCostIntoMetadata,
  serializeCostCenter,
} from '../../src/lib/cost-centers/api-serialize'
import { buildProductServiceMetadata } from '../../src/lib/cost-centers/product-catalog'
import type { CostCenterRecord } from '../../src/lib/db/entities'

describe('cost center API cost serialization', () => {
  it('exposes top-level cost for PROJECT from metadata', () => {
    const center: CostCenterRecord = {
      id: '1',
      code: 'PRJ-1',
      name: '12PCS SPANNER SET',
      type: 'PROJECT',
      description: null,
      isActive: true,
      metadata: buildProductServiceMetadata({
        'Product/Service Name': '12PCS SPANNER SET',
        Cost: '125',
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const dto = serializeCostCenter(center)
    assert.equal(dto.cost, 125)
    assert.equal(dto.type, 'PROJECT')
  })

  it('returns null cost for LOCATION and CLASS', () => {
    const location: CostCenterRecord = {
      id: '2',
      code: 'LOC-1',
      name: 'Dammam',
      type: 'LOCATION',
      description: null,
      isActive: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    assert.equal(serializeCostCenter(location).cost, null)
  })

  it('merges edited cost into project metadata', () => {
    const merged = mergeProjectCostIntoMetadata(
      buildProductServiceMetadata({
        'Product/Service Name': '12PCS SPANNER SET',
        Cost: '100',
        SKU: 'SKU-001',
      }),
      125,
    )
    assert.equal(String(merged.Cost), '125')
    assert.equal((merged.catalog as { cost: number }).cost, 125)
    assert.equal(String(merged.SKU), 'SKU-001')
  })
})
