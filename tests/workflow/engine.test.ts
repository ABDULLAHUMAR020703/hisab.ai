import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateWorkflowConditions,
  stepAppliesToAmount,
  isStepComplete,
} from '../../src/lib/workflow/conditions'

describe('workflow engine conditions', () => {
  describe('evaluateWorkflowConditions', () => {
    it('returns true when no rules configured', () => {
      assert.equal(evaluateWorkflowConditions({}, { amount: 100 }), true)
      assert.equal(evaluateWorkflowConditions(null, { amount: 100 }), true)
    })

    it('evaluates AND rules', () => {
      const result = evaluateWorkflowConditions(
        {
          operator: 'AND',
          rules: [
            { field: 'amount', op: 'gte', value: 1000 },
            { field: 'entityType', op: 'eq', value: 'BILL' },
          ],
        },
        { amount: 1500, entityType: 'BILL' },
      )
      assert.equal(result, true)
    })

    it('evaluates OR rules', () => {
      const result = evaluateWorkflowConditions(
        {
          operator: 'OR',
          rules: [
            { field: 'amount', op: 'lt', value: 100 },
            { field: 'departmentId', op: 'eq', value: 'dept-1' },
          ],
        },
        { amount: 500, departmentId: 'dept-1' },
      )
      assert.equal(result, true)
    })

    it('supports in and contains operators', () => {
      assert.equal(
        evaluateWorkflowConditions(
          { rules: [{ field: 'entityType', op: 'in', value: ['BILL', 'EXPENSE'] }] },
          { entityType: 'EXPENSE' },
        ),
        true,
      )
      assert.equal(
        evaluateWorkflowConditions(
          { rules: [{ field: 'entity_subtype', op: 'contains', value: 'urgent' }] },
          { entitySubtype: 'URGENT-request' },
        ),
        true,
      )
    })
  })

  describe('stepAppliesToAmount', () => {
    it('enforces min and max thresholds', () => {
      assert.equal(stepAppliesToAmount(500, 100, 1000), true)
      assert.equal(stepAppliesToAmount(50, 100, null), false)
      assert.equal(stepAppliesToAmount(5000, null, 1000), false)
    })
  })

  describe('isStepComplete', () => {
    it('sequential mode completes after assignee approves', () => {
      assert.equal(
        isStepComplete('SEQUENTIAL', 'ALL', [{ status: 'APPROVED' }]),
        true,
      )
    })

    it('parallel ANY completes when one approves', () => {
      assert.equal(
        isStepComplete('PARALLEL', 'ANY', [
          { status: 'APPROVED' },
          { status: 'PENDING' },
        ]),
        true,
      )
    })

    it('parallel ALL requires every task approved', () => {
      assert.equal(
        isStepComplete('PARALLEL', 'ALL', [
          { status: 'APPROVED' },
          { status: 'PENDING' },
        ]),
        false,
      )
      assert.equal(
        isStepComplete('PARALLEL', 'ALL', [
          { status: 'APPROVED' },
          { status: 'APPROVED' },
        ]),
        true,
      )
    })
  })
})
