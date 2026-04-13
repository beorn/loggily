---
layout: home

hero:
  name: "Loggily"
  text: "Clarity without the clutter"
  tagline: "Debugs, logs, and spans — structured and dev, server and browser — one TypeScript API. No output, no overhead."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/journey
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/loggily

features:
  - title: "The ?. Optional Chaining Trick"
    details: "Short-circuits the entire call when a log level is disabled — nothing evaluates, not the string interpolation, not the function calls, nothing. ~22x faster than conventional noop loggers."
  - title: "One Pipeline, Six Element Types"
    details: "Objects configure, arrays branch, values write. Config objects, stage functions, file sinks, writable sinks, branch arrays, and console — all in one array. Colorized dev output, structured JSON in production. Same code."
  - title: "Send Anywhere"
    details: "OpenTelemetry (Jaeger, Grafana, Datadog), Pino transports, Sentry, Elasticsearch, CloudWatch, Prometheus, W3C Trace Context. DEBUG= patterns work the same as the debug package."
  - title: "Spans, Metrics, Workers, Async Context"
    details: "using span = log.span('name') for timing with parent-child tracking and trace IDs. Span metrics (p50/p95/p99). Worker thread forwarding via postMessage. AsyncLocalStorage propagation. ~3 KB, zero dependencies."
---

## Install

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

## Getting Started

```typescript
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"

// Config pipeline — objects configure, arrays branch, values write
const log = createLogger("myapp", [
  { level: "debug", metrics: true },     // config object — sets scope
  toOtel({ api: otelApi }),              // stage — forwards to Jaeger/Grafana/Datadog
  pinoTransport,                         // writable — { write } receives events
  { file: "...", format: "json" },       // file sink — formatted strings
  [{ level: "warn" }, { file: "..." }],  // branch — sub-pipeline with own scope
  console,                               // colorized dev output, JSON in production
])

// Structured logging
log.info?.("server started", { port: 3000 })
log.debug?.(`state: ${expensiveFunc()}`) // skipped if debug off
log.error?.(new Error("connection lost"))

// Child loggers — extend namespace, add context
const dbLog = log.child("db", { pool: "main" }) // namespace: "myapp:db"

// Spans — time any operation, auto-track parent/child + trace IDs
// AsyncLocalStorage propagation: logs in async chains inherit span context
{
  using span = dbLog.span("query", { table: "users" })
  const users = await queryUsers() // logs inside queryUsers() get trace IDs
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table: "users"}

// Metrics — p50/p95/p99 from spans
log.metrics.summary() // myapp:db:query: 42 spans, mean=3.2ms, p95=8.4ms

// Composable — build custom factories
const myCreateLogger = pipe(baseCreateLogger, withSpans(), myPlugin())
```

```console
$ DEBUG='*' node app                        # show all debug output
$ DEBUG='myapp:db' node app                 # only database logs
$ LOG_FILE=/tmp/app.log node app            # write to file
$ NODE_ENV=production node app              # structured JSON output
$ TRACE=1 node app                          # enable span timing
```
