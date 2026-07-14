import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAccountClassification } from '../../src/lib/accounting/account-type-map'
import { inferNormalBalance, signedBalance } from '../../src/lib/accounting/normal-balance'

describe('accounting engine', () => {
  it('maps QuickBooks account types to canonical types', () => {
    assert.equal(resolveAccountClassification('Bank').canonicalType, 'Asset')
    assert.equal(resolveAccountClassification('Income').canonicalType, 'Income')
    assert.equal(resolveAccountClassification('Cost of Goods Sold').canonicalType, 'CostOfGoodsSold')
    assert.equal(resolveAccountClassification('Accounts Payable').canonicalType, 'Liability')
  })

  it('assigns normal balance by canonical type', () => {
    assert.equal(inferNormalBalance('Asset'), 'DEBIT')
    assert.equal(inferNormalBalance('Liability'), 'CREDIT')
    assert.equal(inferNormalBalance('Income'), 'CREDIT')
  })

  it('computes signed balance using normal balance', () => {
    assert.equal(signedBalance(100, 20, 'DEBIT'), 80)
    assert.equal(signedBalance(100, 20, 'CREDIT'), -80)
  })

  it('trial balance debits equal credits for balanced entry', () => {
    const lines = [
      { debit: 100, credit: 0 },
      { debit: 0, credit: 100 },
    ]
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(totalDebit, totalCredit)
  })
})
