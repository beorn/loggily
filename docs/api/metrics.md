# Metrics

Collects span timing data (p50/p95/p99) for performance monitoring.

## `{ metrics: true }` (simple)

Add `metrics: true` to any config object. A per-logger `MetricsCollector` is created automatically and exposed as `log.metrics`.

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug", metrics: true }, console])

{
  using span = log.span?.("query")
  // ...
}

log.metrics.stats("myapp:query") // SpanStats | undefined
log.metrics.summary() // formatted string
log.metrics.all() // Map<string, SpanStats>
```

Child loggers inherit the same collector:

```typescript
const db = log.child("db")
{
  using span = db.span?.("query")
  // ...
}
log.metrics.stats("myapp:db:query") // same collector
```

## `withMetrics(collector)` (advanced)

Import from `loggily/metrics`. Use when you need a shared collector across multiple loggers or custom configuration.

```typescript
import { withMetrics, createMetricsCollector } from "loggily/metrics"
import { createLogger } from "loggily"

const collector = createMetricsCollector()
const log = withMetrics(collector)(createLogger("myapp"))

// log.metrics === collector

{
  using span = log.span?.("query")
  // ...
}

// { count, min, max, mean, p50, p95, p99, total }
collector.stats("myapp:query")
collector.summary() // formatted string
collector.reset() // clear data
```

## API

| Export                                | Description                                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| `{ metrics: true }`                   | Config key: auto-creates collector on `log.metrics`           |
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
