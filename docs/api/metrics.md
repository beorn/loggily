# Metrics

Import from `loggily/metrics`. Works everywhere (Node.js, Bun, browser).

Collects span timing data (p50/p95/p99) for performance monitoring. Two modes: ambient (zero setup) or explicit (custom collector).

## Ambient (zero setup)

```typescript
import { spanStats, spanSummary } from "loggily/metrics"

// TRACE=myapp bun run app
// ... spans run ...

console.log(spanSummary())
// myapp:db: 42 spans, mean=3.2ms, p50=2.1ms, p95=8.4ms, p99=12.1ms

const stats = spanStats() // Map<name, SpanStats>
```

Ambient collection activates automatically when you import `loggily/metrics`. The cost is one `recordSpan()` call per span — negligible. The `TRACE` gate controls whether spans are created at all.

## Explicit (custom collector)

```typescript
import { withMetrics, createMetricsCollector } from "loggily/metrics"
import { createLogger } from "loggily"

const collector = createMetricsCollector()
const log = withMetrics(collector)(createLogger("myapp"))

{
  using span = log.span("query")
  // ...
}

collector.stats("myapp:query") // { count, min, max, mean, p50, p95, p99, total }
collector.summary() // formatted string
collector.reset() // clear data
```

## API

| Export                                | Description                                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| `spanStats()`                         | Ambient stats: `Map<name, SpanStats>`                         |
| `spanSummary()`                       | Formatted summary string                                      |
| `resetSpanStats()`                    | Clear ambient data                                            |
| `createMetricsCollector(maxEntries?)` | Create a standalone collector (default 1000 entries per span) |
| `withMetrics(collector?)`             | Wrap a logger to record to a collector (default: ambient)     |

### SpanStats

```typescript
interface SpanStats {
  count: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
  total: number
}
```
