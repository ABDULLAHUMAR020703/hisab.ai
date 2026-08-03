import { processJobBatch } from '@/lib/platform/jobs/workers'
import { assertImportJobSchemaCompatibility } from '@/lib/platform/schema-compatibility'

const pollIntervalMs = Math.max(250, Number(process.env.IMPORT_WORKER_POLL_MS ?? 2000))
let stopping = false

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function requestShutdown(signal: string) {
  stopping = true
  console.log(JSON.stringify({ event: 'quickbooks_worker_shutdown_requested', signal }))
}

process.once('SIGTERM', () => requestShutdown('SIGTERM'))
process.once('SIGINT', () => requestShutdown('SIGINT'))

async function run() {
  await assertImportJobSchemaCompatibility()
  console.log(JSON.stringify({ event: 'quickbooks_worker_started', pollIntervalMs }))
  while (!stopping) {
    const result = await processJobBatch(1, 'QUICKBOOKS_IMPORT_STEP')
    if (result.processed === 0) await sleep(pollIntervalMs)
  }
  console.log(JSON.stringify({ event: 'quickbooks_worker_stopped' }))
}

run().catch((error) => {
  console.error(JSON.stringify({
    event: 'quickbooks_worker_fatal',
    message: error instanceof Error ? error.message : String(error),
  }))
  process.exitCode = 1
})
