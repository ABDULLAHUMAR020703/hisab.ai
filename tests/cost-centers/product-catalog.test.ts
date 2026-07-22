import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProductServiceMetadata,
  defaultUnitPriceFromProject,
  extractProductCatalog,
  extractProductCost,
  parseMoneyValue,
} from '../../src/lib/cost-centers/product-catalog'

describe('product/service catalog metadata', () => {
  it('parses money values from spreadsheet-like cells', () => {
    assert.equal(parseMoneyValue('100'), 100)
    assert.equal(parseMoneyValue('100.50'), 100.5)
    assert.equal(parseMoneyValue('SAR 70'), 70)
    assert.equal(parseMoneyValue(50), 50)
    assert.equal(parseMoneyValue(''), null)
    assert.equal(parseMoneyValue('—'), null)
  })

  it('extracts Cost from imported Product/Service columns', () => {
    const metadata = buildProductServiceMetadata({
      'Product/Service Name': '12PCS SPANNER SET',
      Quantity: '10',
      'Item Type': 'Inventory',
      Category: 'Tools',
      SKU: 'SKU-001',
      Purchase: 'No',
      'Sales Price': 'Yes',
      Price: '150',
      Cost: '100',
      'Income Account': '4100',
      'Expense Account': '5000',
      'Inventory Asset Account': '1500',
      'Sales Description': 'Spanners',
      'Purchase Description': 'Buy spanners',
      'Reorder Point': '5',
      'Preferred Supplier': 'Supplier A',
    })

    assert.equal(extractProductCost(metadata), 100)
    assert.equal(defaultUnitPriceFromProject(metadata), 100)
    assert.equal(extractProductCatalog(metadata).salesPrice, 150)
    assert.equal(extractProductCatalog(metadata).sku, 'SKU-001')
    assert.equal(extractProductCatalog(metadata).category, 'Tools')
    assert.ok(metadata.Cost === '100')
    assert.ok(metadata.catalog)
  })

  it('returns 0 unit price when Cost is missing', () => {
    const metadata = buildProductServiceMetadata({
      'Product/Service Name': 'FIRST AID KIT',
      Cost: '',
      Price: '50',
    })
    assert.equal(extractProductCost(metadata), null)
    assert.equal(defaultUnitPriceFromProject(metadata), 0)
  })

  it('reads Cost from legacy metadata without catalog block', () => {
    assert.equal(
      extractProductCost({
        'Product/Service Name': 'ALLEN KEY SET',
        Cost: '70',
      }),
      70,
    )
  })
})
