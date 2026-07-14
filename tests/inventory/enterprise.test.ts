import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateWeightedAverageCost,
  consumeFifoLayers,
  calculateStandardIssueCost,
  assertNonNegativeStock,
  calculateValuation,
  calculateCogsVariance,
  calculateAvailableQuantity,
} from '../../src/lib/inventory/costing'

describe('enterprise inventory costing', () => {
  it('calculates weighted average cost on receipt', () => {
    const avg = calculateWeightedAverageCost(100, 10, 50, 12)
    assert.equal(avg, 10.6667)
  })

  it('consumes FIFO layers oldest first', () => {
    const result = consumeFifoLayers([
      { id: '1', quantityRemaining: 30, unitCost: 10, receivedAt: new Date('2026-01-01') },
      { id: '2', quantityRemaining: 40, unitCost: 12, receivedAt: new Date('2026-02-01') },
    ], 50)
    assert.equal(result.totalCost, 540)
    assert.equal(result.consumedLayers.length, 2)
    assert.equal(result.consumedLayers[0].quantity, 30)
    assert.equal(result.consumedLayers[1].quantity, 20)
  })

  it('uses standard cost for issues', () => {
    const result = calculateStandardIssueCost(10, 25)
    assert.equal(result.totalCost, 250)
    assert.equal(result.unitCost, 25)
  })

  it('prevents negative stock when not allowed', () => {
    assert.throws(
      () => assertNonNegativeStock(5, 10, false),
      /NEGATIVE_STOCK_PREVENTED/,
    )
    assert.doesNotThrow(() => assertNonNegativeStock(5, 10, true))
  })

  it('calculates available quantity net of reservations', () => {
    assert.equal(calculateAvailableQuantity(100, 25), 75)
  })

  it('values inventory at quantity times unit cost', () => {
    assert.equal(calculateValuation(50, 12.5), 625)
  })

  it('calculates COGS variance against standard cost', () => {
    assert.equal(calculateCogsVariance(280, 25, 10), 30)
  })
})
