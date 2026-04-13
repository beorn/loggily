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
import { toOtel } from "loggily/otel"
import * as otelApi from "@opentelemetry/api"

// One pipeline: console + OTEL + a Pino transport + metrics
const log = createLogger("myapp", [
  { level: "debug", metrics: true },
  toOtel({ api: otelApi }),
  pinoTransport,                        // any { write } receives raw Events
  console,
])

// Structured logging — ?. skips everything when the level is disabled
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))

// Spans — automatic timing, parent-child tracking, trace IDs
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table: "users"}
// → also forwarded to OTLP backend and Pino transport

// Metrics — check p50/p95/p99 via log.metrics
for (const [name, s] of log.metrics.all()) {
  if (s.p95 > 100) console.warn(`${name} is slow: p95=${s.p95}ms`)
}
```

### Custom Writable

Any object with a `write` method receives raw Event objects:

```typescript
const log = createLogger("myapp", [
  { write: (event) => fetch("/ingest", { method: "POST", body: JSON.stringify(event) }) },
  console,
])
```

### Custom Stage

Functions transform, filter, or enrich events inline:

```typescript
const log = createLogger("myapp", [
  // Drop sensitive messages
  (event) => event.kind === "log" && event.message.includes("secret") ? null : event,
  // Tag every event with the hostname
  (event) => ({ ...event, props: { ...event.props, host: os.hostname() } }),
  console,
])
