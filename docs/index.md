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
  - title: "OpenTelemetry Bridge"
    details: "toOtel() stage forwards events to any OTLP backend (Jaeger, Grafana, Datadog). Transparent — events pass through to your other pipeline destinations too."
  - title: "Pino Transport Compatible"
    details: "Writable sinks with objectMode receive raw Event objects. Use any Pino transport as a pipeline destination. DEBUG= patterns compatible with the debug package."
  - title: "Worker Threads + Metrics"
    details: "Pipeline-based worker logging via postMessage. Span metrics with p50/p95/p99 aggregation. Async context propagation via AsyncLocalStorage."
  - title: "Composable, Unified"
    details: "One pipeline replaces debug + JSON logger + tracing SDK. Extend with pipe(baseCreateLogger, withSpans(), myPlugin()). Config arrays for branching: objects configure, arrays branch, values write."
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

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug" }, console])

// ?. skips the entire call — including argument evaluation — when the level is disabled
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))
```

### Spans

```typescript
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// SPAN myapp:db:query (45ms) {count: 100, table: "users"}
```

### Metrics

```typescript
import { spanStats } from "loggily/metrics"

// After spans run, get p50/p95/p99 aggregates
const stats = spanStats()
// Map { "myapp:db:query" => { count: 42, p50: 3.2, p95: 8.4, p99: 12.1, ... } }
```

### OpenTelemetry

```typescript
import * as otelApi from "@opentelemetry/api"
import { toOtel } from "loggily/otel"

// Forward to OTLP AND console — toOtel() is transparent
const log = createLogger("myapp", [toOtel({ api: otelApi }), console])
```

### Pino Transports

```typescript
import { createLogger } from "loggily"

// Any Pino transport works — objectMode receives raw Event objects
const log = createLogger("myapp", [{ write: (event) => pinoTransport.write(event), objectMode: true }, console])
```
