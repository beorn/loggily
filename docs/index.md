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
  - icon: ⚡
    title: "Free If Silenced"
    details: "The optional chaining trick makes disabled log calls practically free — the entire call short-circuits, so not even the arguments evaluate. ~22x faster than noop loggers."
    link: /guide/benchmarks
    linkText: "See benchmarks"
  - icon: 🔭
    title: "All-in-One Observability"
    details: "One API replaces debug, your JSON logger, and your tracing SDK. Structured logs, namespace filtering, spans with trace IDs, metrics, worker threads, and async context propagation — ~3 KB, zero dependencies."
    link: /guide/journey
    linkText: "Get started"
  - icon: 🌐
    title: "Works Everywhere"
    details: "Same API in browser and server (Node.js, Bun). Beautiful colorized logs in development, performant structured JSON in production — no compromise."
    link: /guide/comparison
    linkText: "See comparison"
  - icon: 🔌
    title: "Send Anywhere"
    details: "One config array wires all your destinations: console, files, OpenTelemetry (Jaeger, Grafana, Datadog), Pino transports, Sentry, Elasticsearch, CloudWatch, Prometheus — or write your own sink. Objects configure, arrays branch, values write."
    link: /guide/destinations
    linkText: "See all destinations"
---

## Quick Look

```typescript
import { createLogger } from"loggily"

const log = createLogger("myapp") // zero config — reads LOG_LEVEL, DEBUG from env

log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key:"user:42" })
log.error?.(new Error("connection lost"))
```

**The `?.` optional chaining trick** short-circuits the entire call when a log level is disabled, so nothing evaluates — not the string interpolation, not the function calls, nothing. In benchmarks, that's [~22x faster](https://loggily.dev/guide/benchmarks) than conventional noop loggers. [See how Loggily compares →](/guide/comparison)

## Getting Started

::: code-group

```console [npm]
$ npm install loggily
```

```console [bun]
$ bun add loggily
```

```console [pnpm]
$ pnpm add loggily
```

```console [yarn]
$ yarn add loggily
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
import { createLogger } from"loggily"
import { toOtel } from"loggily/otel"

// Config pipeline — objects configure, arrays branch, values write
const log = createLogger("myapp", [
  { level:"debug", metrics: true },     // config object — sets scope
  toOtel({ api: otelApi }),              // stage — forwards to Jaeger/Grafana/Datadog
  pinoTransport,                         // writable — { write } receives events
  { file:"...", format:"json" },       // file sink — formatted strings
  [{ level:"warn" }, { file:"..." }],  // branch — sub-pipeline with own scope
  console,                               // colorized dev output, JSON in production
])

// Structured logging
log.info?.("server started", { port: 3000 })
log.debug?.(`state: ${expensiveFunc()}`) // skipped if debug off
log.error?.(new Error("connection lost"))

// Child loggers — extend namespace, add context
const dbLog = log.child("db", { pool:"main" }) // namespace:"myapp:db"

// Spans — time any operation, auto-track parent/child + trace IDs
// AsyncLocalStorage propagation: logs in async chains inherit span context
{
  using span = dbLog.span("query", { table:"users" })
  const users = await queryUsers() // logs inside queryUsers() get trace IDs
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table:"users"}

// Metrics — p50/p95/p99 from spans
log.metrics.summary() // myapp:db:query: 42 spans, mean=3.2ms, p95=8.4ms

// Composable — build custom factories
const myCreateLogger = pipe(baseCreateLogger, withSpans(), myPlugin())
```

Also supports async context propagation, [worker threads](/guide/workers), and browsers.

**Works with:** OpenTelemetry (Jaeger, Grafana, Datadog, any OTLP backend) · [Pino transports](/guide/destinations#pino) · Sentry · Elasticsearch · AWS CloudWatch · Prometheus · W3C Trace Context · `DEBUG=` patterns · [See all destinations →](/guide/destinations)

## About

Born from the frustration of juggling separate systems for debug logging, structured production logs, metrics, and spans — each with its own API, config, and propagation — and then duplicating the whole setup again because browser and terminal needed completely different pipelines and destinations. Loggily unifies it all: one API, one config, one pipeline that works everywhere, without the overhead when logs are off.

**Requirements:** Node.js ≥ 23.6 or Bun ≥ 1.0. ESM-only. TypeScript 5.2+ for `using` (`.end()` works on any version). Browser supported via conditional export.

**When not to use Loggily:** if you need auto-instrumentation (HTTP, database, gRPC) use OpenTelemetry's SDK directly; if you need log rotation or dozens of transport plugins, Pino's ecosystem is deeper.
