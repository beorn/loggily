# Metrics

Import from `loggily/metrics`. Works everywhere (Node.js, Bun, browser).

Collects span timing data (p50/p95/p99) for performance monitoring via explicit collectors.

## Usage

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
| `createMetricsCollector(maxEntries?)` | Create a standalone collector (default 1000 entries per span) |
| `withMetrics(collector)`              | Wrap a logger to record spans to a collector                  |

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
