type CounterMap = Map<string, number>
type HistogramBucket = { count: number; sum: number; max: number }

const counters: CounterMap = new Map()
const histograms: Map<string, HistogramBucket> = new Map()

export function incrementCounter(name: string, value = 1) {
  counters.set(name, (counters.get(name) ?? 0) + value)
}

export function recordDuration(name: string, durationMs: number) {
  const bucket = histograms.get(name) ?? { count: 0, sum: 0, max: 0 }
  bucket.count += 1
  bucket.sum += durationMs
  bucket.max = Math.max(bucket.max, durationMs)
  histograms.set(name, bucket)
}

export function getMetricsSnapshot() {
  return {
    counters: Object.fromEntries(counters.entries()),
    histograms: Object.fromEntries(
      [...histograms.entries()].map(([name, b]) => [name, { ...b, avg: b.count ? b.sum / b.count : 0 }]),
    ),
    collectedAt: new Date().toISOString(),
  }
}

export function resetMetrics() {
  counters.clear()
  histograms.clear()
}
