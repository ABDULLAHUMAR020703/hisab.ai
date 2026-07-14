import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFxAmounts,
  computeRealizedFxDifference,
  computeUnrealizedAdjustment,
  convertAmountAtRate,
} from '../../src/lib/currency/fx-conversion'
import {
  calculateCompoundTaxes,
  calculateExclusiveTax,
  calculateInclusiveTax,
  computeLegacyLineTax,
  computeLineTaxFromRates,
  splitInclusiveAmount,
} from '../../src/lib/tax/calculator'

describe('multi-currency conversion', () => {
  it('converts transaction amounts to base currency', () => {
    const fx = buildFxAmounts({
      debit: 1000,
      credit: 0,
      transactionCurrency: 'USD',
      baseCurrency: 'SAR',
      reportingCurrency: 'SAR',
      exchangeRate: 3.75,
    })
    assert.equal(fx.baseDebit, 3750)
    assert.equal(fx.baseCredit, 0)
    assert.equal(fx.exchangeRate, 3.75)
  })

  it('computes realized FX on payment settlement', () => {
    const gain = computeRealizedFxDifference({
      transactionAmount: 1000,
      originalRate: 3.75,
      settlementRate: 3.80,
    })
    assert.equal(gain, 50)
  })

  it('computes unrealized FX revaluation adjustment', () => {
    const adjustment = computeUnrealizedAdjustment({
      transactionBalance: 5000,
      priorRate: 3.75,
      newRate: 3.70,
    })
    assert.equal(adjustment, -250)
  })

  it('keeps 1:1 rate for same currency', () => {
    assert.equal(convertAmountAtRate(100, 1), 100)
  })
})

describe('tax engine calculator', () => {
  it('calculates exclusive VAT (legacy 15%)', () => {
    const line = computeLegacyLineTax(1, 100, 15)
    assert.equal(line.netAmount, 100)
    assert.equal(line.taxAmount, 15)
    assert.equal(line.grossAmount, 100)
  })

  it('calculates inclusive VAT', () => {
    const tax = calculateInclusiveTax(115, 15)
    assert.equal(tax, 15)
    const split = splitInclusiveAmount(115, 15)
    assert.equal(split.net, 100)
    assert.equal(split.tax, 15)
  })

  it('calculates exclusive tax amount', () => {
    assert.equal(calculateExclusiveTax(200, 15), 30)
  })

  it('supports compound additive taxes', () => {
    const components = calculateCompoundTaxes(100, [
      { name: 'VAT', rate: 15 },
      { name: 'Municipality', rate: 2 },
    ], 'ADDITIVE')
    assert.equal(components.length, 2)
    assert.equal(components[0].taxAmount, 15)
    assert.equal(components[1].taxAmount, 2)
  })

  it('supports inclusive single-rate lines', () => {
    const line = computeLineTaxFromRates(1, 115, [{
      name: 'VAT',
      rate: 15,
      taxMode: 'INCLUSIVE',
    }])
    assert.equal(line.netAmount, 100)
    assert.equal(line.taxAmount, 15)
  })

  it('preserves Saudi VAT default through legacy path', () => {
    const line = computeLegacyLineTax(2, 50, 15)
    assert.equal(line.taxAmount, 15)
    assert.equal(line.netAmount, 100)
  })
})
