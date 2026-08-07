import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { createProgressWriteQueue } from '../../src/lib/import-export/jobs/progress-write-queue'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function silenceLogger<T>(operation: () => T): T {
  const originalError = console.error
  console.error = () => undefined
  try {
    return operation()
  } finally {
    console.error = originalError
  }
}

test('a failed progress write never rejects the drain that gates orchestration', async () => {
  const queue = createProgressWriteQueue({ importJobId: 'job-1', companyId: 'company-1' })

  silenceLogger(() => {
    queue.enqueue(async () => { throw new Error('progress persist failed') })
  })

  await queue.drain()
  assert.equal(queue.failureCount, 1)
})

test('a failed progress write does not poison later activity writes', async () => {
  const queue = createProgressWriteQueue({ importJobId: 'job-1' })
  const persisted: string[] = []

  silenceLogger(() => {
    queue.enqueue(async () => { persisted.push('materialization') })
    queue.enqueue(async () => { throw new Error('transient database failure') })
    queue.enqueue(async () => { persisted.push('report_generation') })
  })

  await queue.drain()
  assert.deepEqual(persisted, ['materialization', 'report_generation'])
  assert.equal(queue.failureCount, 1)
})

test('progress writes stay serialized in enqueue order', async () => {
  const queue = createProgressWriteQueue({ importJobId: 'job-1' })
  const order: string[] = []
  const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

  queue.enqueue(async () => { await delay(20); order.push('first') })
  queue.enqueue(async () => { order.push('second') })

  await queue.drain()
  assert.deepEqual(order, ['first', 'second'])
})

test('a rejected write is handled in the same tick so the worker process survives', async () => {
  const rejections: unknown[] = []
  const capture = (reason: unknown) => { rejections.push(reason) }
  process.on('unhandledRejection', capture)
  try {
    const queue = createProgressWriteQueue({ importJobId: 'job-1' })
    silenceLogger(() => {
      queue.enqueue(async () => { throw new Error('progress persist failed') })
    })
    // Give Node the ticks in which an unhandled rejection would be reported.
    await new Promise<void>((done) => setTimeout(done, 50))
    await queue.drain()
  } finally {
    process.off('unhandledRejection', capture)
  }
  assert.deepEqual(rejections, [])
})

test('the import step drains through the fault-isolated queue', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  assert.match(route, /createProgressWriteQueue\(/)
  assert.match(route, /await progressWrites\.drain\(\)/)
  // The raw chain kept a rejected promise unhandled until the step ended.
  assert.doesNotMatch(route, /progressWrite = progressWrite\.then\(/)
})

test('post-materialization orchestration steps are individually traceable', () => {
  const route = read('src/app/api/import-export/[module]/import/route.ts')
  for (const step of ['save_skips', 'save_errors', 'cancel_checks', 'finalize', 'finalized']) {
    assert.match(route, new RegExp(`orchestrationStep\\('${step}'`))
  }
})
