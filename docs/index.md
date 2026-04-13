---
layout: home

hero:
  name: "Loggily"
  text: "Debugs, logs, and spans — one API"
  tagline: "Clarity without the clutter. One namespace tree. One output pipeline. One ?. pattern for near-zero overhead. Pure TypeScript. ~3KB. Zero dependencies."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/journey
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/loggily

features:
  - title: "Near-Zero Cost via ?."
    details: "Optional chaining skips the entire call — including argument evaluation — when a level is disabled. ~22x faster than a conventional noop logger in benchmarks."
  - title: "Structured Logs + Spans"
    details: "Colorized console in dev, structured JSON in production — same code. Spans with parent-child tracking and trace IDs. Namespace filtering (DEBUG=myapp:db). One import, one config."
  - title: "Send Anywhere"
    details: "OpenTelemetry, Datadog, Grafana, Jaeger, Sentry, Elasticsearch, CloudWatch, Prometheus — via OTEL bridge, writable sinks, or stage functions. See Destinations."
  - title: "Pino + debug Compatible"
    details: "Works with object-mode writable sinks (compatible with Pino transport interface). DEBUG= namespace patterns work the same as the debug package. Drop-in for existing setups."
  - title: "Worker Threads + Metrics"
    details: "Pipeline-based worker logging via postMessage. Span metrics with p50/p95/p99 aggregation. Async context propagation via AsyncLocalStorage."
  - title: "Composable, Unified"
    details: "One pipeline replaces debug + JSON logger + tracing SDK. Extend with pipe(baseCreateLogger, withEnvDefaults(), withSpans(), myPlugin()). Config arrays for branching: objects configure, arrays branch, values write."
  - title: "~3KB, Zero Dependencies"
    details: "Pure TypeScript, ESM-only. Runs on Node.js 23.6+, Bun 1.0+, and browsers. Dev console + production JSON from the same code."
---

> Early release (0.x) — API may evolve before 1.0.

## Quick Start

::: code-group

```bash [npm]
npm install loggily
```

```bash [bun]
bun add loggily
```

```bash [pnpm]
pnpm add loggily
```

```bash [yarn]
yarn add loggily
```

:::

## Quick Start

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug" }, console])

log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))

// Child loggers
const dbLog = log.child("db", { pool: "main" }) // namespace: "myapp:db"

// Spans — time any operation
{
  using span = dbLog.span("query", { table: "users" })
  const users = await queryUsers() // your DB call
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table: "users"}
```

## Complete Example

The config array accepts six element types — here they are in one pipeline:

```typescript
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"
import * as otelApi from "@opentelemetry/api"

const log = createLogger("myapp", [
  // "myapp" — namespace, filter with DEBUG=myapp
  // config object — sets scope
  { level: "debug", metrics: true },
  // stage — transforms/forwards events
  toOtel({ api: otelApi }),
  // writable — { write } receives raw Events
  pinoTransport,
  // file sink — writes formatted strings
  { file: "/tmp/app.log", format: "json" },
  // branch — sub-pipeline with own scope
  [{ level: "error" }, { file: "/tmp/err.log" }],
  // console — colorized, human-readable
  console,
])
```

### Custom writable

Any `{ write }` object receives raw Event objects:

```typescript
const log = createLogger("myapp", [
  {
    write: (event) =>
      fetch("/ingest", {
        method: "POST",
        body: JSON.stringify(event),
      }),
  },
  console,
])
```

### Custom stage

Functions transform, filter, or enrich events inline:

```typescript
const log = createLogger("myapp", [
  (event) =>
    event.kind === "log" && event.message.includes("secret") ? null : event,
  (event) => ({
    ...event,
    props: { ...event.props, host: os.hostname() },
  }),
  console,
])
```

### Metrics

```typescript
// { metrics: true } auto-creates a collector on log.metrics
for (const [name, s] of log.metrics.all()) {
  if (s.p95 > 100) console.warn(`${name} is slow: p95=${s.p95}ms`)
}
```
