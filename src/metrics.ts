/**
 * Metrics collection for loggily spans.
 *
 * Explicit only: `withMetrics(collector)(logger)` for custom collection.
 *
 * @example
 * ```typescript
 * import { withMetrics, createMetricsCollector } from "loggily/metrics"
 * const collector = createMetricsCollector()
 * const log = withMetrics(collector)(createLogger("myapp"))
 * ```
 */

import {
  type SpanRecorder,
  type SpanRecord,
  type ConditionalLogger,
  type Logger,
  type LazyProps,
  type SpanLogger,
} from "./core.js"

export type { SpanRecorder, SpanRecord }

// ============ Stats ============

export interface SpanStats {
  count: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
  total: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1)
  return sorted[idx]!
}

function computeStats(durations: number[]): SpanStats {
  const sorted = [...durations].sort((a, b) => a - b)
  const total = sorted.reduce((sum, d) => sum + d, 0)
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length > 0 ? total / sorted.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    total,
  }
}

// ============ Collector ============

export interface MetricsCollector extends SpanRecorder {
  /** Get stats for a specific span namespace */
  stats(name: string): SpanStats | undefined
  /** Get stats for all recorded namespaces */
  all(): Map<string, SpanStats>
  /** Format a human-readable summary */
  summary(): string
  /** Reset all collected data */
  reset(): void
}

export function createMetricsCollector(maxEntries = 1000): MetricsCollector {
  const store = new Map<string, number[]>()

  return {
    recordSpan(data: SpanRecord): void {
      let arr = store.get(data.name)
      if (!arr) {
        arr = []
        store.set(data.name, arr)
      }
      arr.push(data.durationMs)
      // Bound memory: keep last N entries per namespace
      if (arr.length > maxEntries) arr.shift()
    },

    stats(name: string): SpanStats | undefined {
      const arr = store.get(name)
      if (!arr || arr.length === 0) return undefined
      return computeStats(arr)
    },

    all(): Map<string, SpanStats> {
      const result = new Map<string, SpanStats>()
      for (const [name, durations] of store) {
        if (durations.length > 0) result.set(name, computeStats(durations))
      }
      return result
    },

    summary(): string {
      const entries = [...this.all().entries()]
      if (entries.length === 0) return "(no span data)"
      const lines = entries.map(
        ([name, s]) =>
          `${name}: ${s.count} spans, mean=${s.mean.toFixed(1)}ms, p50=${s.p50.toFixed(1)}ms, p95=${s.p95.toFixed(1)}ms, p99=${s.p99.toFixed(1)}ms`,
      )
      return lines.join("\n")
    },

    reset(): void {
      store.clear()
    },
  }
}

// ============ withMetrics ============

/**
 * Compose a logger with a metrics collector.
 * Returns a curried wrapper: `withMetrics(collector)(logger)`
 *
 * Records span duration to the provided collector on span disposal.
 * Stackable: `withMetrics(a)(withMetrics(b)(logger))` fans out to both.
 *
 * @example
 * ```typescript
 * const collector = createMetricsCollector()
 * const log = withMetrics(collector)(createLogger("myapp"))
 * ```
 */
export function withMetrics(collector: SpanRecorder): (logger: ConditionalLogger) => ConditionalLogger {
  return (logger: ConditionalLogger): ConditionalLogger => {
    // Wrap the logger's span method to intercept disposal
    return new Proxy(logger, {
      get(target, prop: string | symbol) {
        if (prop === "metrics") {
          return collector
        }
        if (prop === "span") {
          const originalSpan = target.span
          if (!originalSpan) return undefined // TRACE off — preserve ?.  behavior
          return (namespace?: string, props?: LazyProps): SpanLogger => {
            const span = originalSpan.call(target, namespace, props)
            // Wrap disposal to record to our collector
            const originalDispose = (span as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose]
            ;(span as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose] = () => {
              originalDispose.call(span)
              // After original disposal computed duration, record it
              if (span.spanData?.duration != null) {
                collector.recordSpan({ name: span.name, durationMs: span.spanData.duration })
              }
            }
            return span
          }
        }
        if (prop === "child") {
          return (
            namespaceOrContext?: string | Record<string, unknown>,
            childProps?: Record<string, unknown>,
          ): ConditionalLogger => {
            const child = target.child(namespaceOrContext as string, childProps)
            return withMetrics(collector)(child)
          }
        }
        if (prop === "logger") {
          // Child loggers inherit the metrics wrapper
          return (namespace?: string, childProps?: Record<string, unknown>): Logger => {
            const child = target.logger(namespace, childProps)
            // Re-wrap the child — withMetrics(collector) applied recursively
            return withMetrics(collector)(child as unknown as ConditionalLogger) as unknown as Logger
          }
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop]
      },
    })
  }
}
