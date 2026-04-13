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
  - title: "Free If Silenced"
    details: "The optional chaining trick short-circuits disabled log calls entirely — not just the log call, but all argument evaluation too. ~22x faster than conventional noop loggers in benchmarks."
  - title: "Three Tools in One"
    details: "Replace debug (namespace filtering), your JSON logger (structured production output), and ad-hoc timers (spans with trace IDs, metrics, and AsyncLocalStorage propagation). Worker threads included. One import, one config, one API. ~3 KB, zero dependencies."
  - title: "Beautiful Dev, Structured Prod"
    details: "Colorized, human-readable console output in development. Structured JSON in production. Same code, no compromise. Switch with NODE_ENV."
  - title: "Browser and Terminal"
    details: "One pipeline, both environments. Bundlers auto-select the browser entry point. Node.js, Bun, and browsers — same API, same config."
  - title: "Send Anywhere"
    details: "OpenTelemetry (Jaeger, Grafana, Datadog), Pino transports, Sentry, Elasticsearch, CloudWatch, Prometheus, W3C Trace Context. Same DEBUG= patterns as the debug package."
---

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

```console
$ DEBUG='*' node app                        # show all debug output
$ DEBUG='myapp:db' node app                 # only database logs
$ LOG_FILE=/tmp/app.log node app            # write to file
$ NODE_ENV=production node app              # structured JSON output
$ TRACE=1 node app                          # enable span timing
```

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
