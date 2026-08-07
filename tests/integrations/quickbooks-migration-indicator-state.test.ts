import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPLETED_COLLAPSE_MS,
  FAILED_COLLAPSE_MS,
  IndicatorAutoCollapseController,
  initialIndicatorPresentation,
  presentationAfterCollapseRequest,
  presentationAfterExpand,
  presentationAfterExitAnimation,
  presentationForSessionTransition,
  resolveIndicatorCollapseDelayMs,
} from '../../src/lib/import-export/wizard/migration-indicator-state'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('expand stays open: same-session polls do not rewrite presentation', () => {
  const dismissed = new Set<string>()
  const expanded = new Set<string>(['s1'])

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'completed',
      nextState: 'completed',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    null,
  )

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'running',
      nextState: 'running',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    null,
  )

  assert.equal(presentationAfterExpand(false), 'expanded')
  assert.equal(presentationAfterExpand(true), null)
})

test('expand while polling continues: progress churn keeps null transition', () => {
  const dismissed = new Set<string>()
  const expanded = new Set<string>()

  // Mimic many poll ticks after user expanded a completed migration.
  for (let i = 0; i < 25; i += 1) {
    assert.equal(
      presentationForSessionTransition({
        previousSessionId: 's1',
        nextSessionId: 's1',
        previousState: 'completed',
        nextState: 'completed',
        dismissedIds: dismissed,
        expandedIds: expanded,
      }),
      null,
      `poll ${i} must not force collapse/expand`,
    )
  }

  // User expand is an explicit presentation write, independent of polls.
  assert.equal(presentationAfterExpand(false), 'expanded')
  assert.equal(presentationAfterCollapseRequest('expanded'), 'exiting')
  assert.equal(presentationAfterExitAnimation(false), 'collapsed')
})

test('expand after completion: terminal transition opens once, later polls stay null', () => {
  const dismissed = new Set<string>()
  const expanded = new Set<string>()

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'running',
      nextState: 'completed',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    'expanded',
  )

  assert.equal(resolveIndicatorCollapseDelayMs('completed'), COMPLETED_COLLAPSE_MS)

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'completed',
      nextState: 'completed',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    null,
  )

  // After auto-collapse, reopening is still allowed.
  assert.equal(presentationAfterExpand(false), 'expanded')
})

test('expand after failure: failed transition expands and rearms 10s delay', () => {
  const dismissed = new Set<string>()
  const expanded = new Set<string>()

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'running',
      nextState: 'failed',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    'expanded',
  )
  assert.equal(resolveIndicatorCollapseDelayMs('failed'), FAILED_COLLAPSE_MS)
  assert.equal(resolveIndicatorCollapseDelayMs('running'), null)
})

test('expand after retry: failed → running re-expands the running panel', () => {
  const dismissed = new Set<string>()
  const expanded = new Set<string>(['s1'])

  assert.equal(
    presentationForSessionTransition({
      previousSessionId: 's1',
      nextSessionId: 's1',
      previousState: 'failed',
      nextState: 'running',
      dismissedIds: dismissed,
      expandedIds: expanded,
    }),
    'expanded',
  )

  // Running has no auto-collapse delay.
  assert.equal(resolveIndicatorCollapseDelayMs('running'), null)
})

test('repeated expand/collapse cycles arm exactly one timer and do not leak', async () => {
  const controller = new IndicatorAutoCollapseController()
  let fires = 0
  let expectedArms = 0

  for (let cycle = 0; cycle < 5; cycle += 1) {
    // Expand: cancel prior + fresh arm (same as expandFromIcon + effect).
    controller.arm(30, () => {
      fires += 1
    })
    expectedArms += 1
    assert.equal(controller.isArmed, true)
    assert.equal(controller.timesArmed, expectedArms)

    // Collapse before fire: clear must drop the pending handle.
    controller.clear()
    assert.equal(controller.isArmed, false)

    // Re-expand.
    controller.arm(30, () => {
      fires += 1
    })
    expectedArms += 1
    assert.equal(controller.isArmed, true)
    assert.equal(controller.timesArmed, expectedArms)
  }

  await sleep(50)
  assert.equal(fires, 1, 'only the last armed timer should fire')
  assert.equal(controller.timesFired, 1)
  assert.equal(controller.isArmed, false)

  // Rearm after fire; clear without waiting must not fire again.
  controller.arm(20, () => {
    fires += 1
  })
  controller.clear()
  await sleep(40)
  assert.equal(fires, 1)
  assert.equal(controller.timesFired, 1)
})

test('arm replaces prior timer so only one auto-collapse exists', async () => {
  const controller = new IndicatorAutoCollapseController()
  const order: string[] = []

  controller.arm(40, () => order.push('first'))
  controller.arm(40, () => order.push('second'))
  assert.equal(controller.timesArmed, 2)
  assert.equal(controller.isArmed, true)

  await sleep(60)
  assert.deepEqual(order, ['second'])
  assert.equal(controller.timesFired, 1)
})

test('initial presentation respects dismissed and expanded terminal memory', () => {
  assert.equal(
    initialIndicatorPresentation({
      sessionId: 's1',
      state: 'completed',
      dismissedIds: new Set(['s1']),
      expandedIds: new Set(),
    }),
    'dismissed',
  )
  assert.equal(
    initialIndicatorPresentation({
      sessionId: 's1',
      state: 'failed',
      dismissedIds: new Set(),
      expandedIds: new Set(['s1']),
    }),
    'expanded',
  )
  assert.equal(
    initialIndicatorPresentation({
      sessionId: 's1',
      state: 'completed',
      dismissedIds: new Set(),
      expandedIds: new Set(),
    }),
    'collapsed',
  )
  assert.equal(
    initialIndicatorPresentation({
      sessionId: 's1',
      state: 'running',
      dismissedIds: new Set(),
      expandedIds: new Set(),
    }),
    'expanded',
  )
})
