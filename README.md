# Loggily

**Clarity without the clutter.**

Debugs, logs, and spans -- one API.

[![Tests](https://github.com/beorn/loggily/actions/workflows/test.yml/badge.svg)](https://github.com/beorn/loggily/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/loggily.svg)](https://www.npmjs.com/package/loggily)
[![size](https://img.shields.io/bundlephobia/minzip/loggily)](https://bundlephobia.com/package/loggily)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Most apps end up with three logging tools: `debug` for local troubleshooting, a JSON logger for production, and ad-hoc timers or a tracing SDK for performance. Three APIs, three configs, three output formats.

Loggily replaces all three with one namespace tree and one output pipeline. Pure TypeScript, zero dependencies, ~3 KB.

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug" }, console])

log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))
```

Readable, colorized output in development (colors don't render on GitHub -- run it in a terminal):

```
14:32:15 INFO myapp server started {port: 3000}
14:32:15 DEBUG myapp cache hit {key: "user:42"}
14:32:15 ERROR myapp connection lost
```

Set `NODE_ENV=production` and the same calls emit structured JSON:

```json
{
  "time": "2024-01-15T14:32:15.123Z",
  "level": "info",
  "name": "myapp",
  "msg": "server started",
  "port": 3000
}
```

## Why the `?.`

Disabled logs should not build strings, serialize objects, or compute snapshots just to throw them away.

With most loggers, this work still happens:

```typescript
log.debug(`state: ${JSON.stringify(computeExpensiveState())}`)
// computeExpensiveState() runs even when debug is off
```

With Loggily, optional chaining short-circuits the entire call:

```typescript
log.debug?.(`state: ${JSON.stringify(computeExpensiveState())}`)
// nothing runs when debug is off — not the function, not the stringify, not the template
```

In benchmarks with expensive disabled log arguments, this is [~22x faster](https://loggily.dev/guide/benchmarks) than a conventional noop logger.

## Install

```bash
npm install loggily
```

| Requirement   | Version                                         |
| ------------- | ----------------------------------------------- |
| Node.js       | >= 23.6                                         |
| Bun           | 1.0+                                            |
| TypeScript    | 5.2+ for `using`; `.end()` works on any version |
| Module format | ESM-only                                        |
| Browser       | Supported via conditional export                |

Loggily uses `Symbol.dispose` (TC39 Explicit Resource Management) for span cleanup, which requires a modern runtime.

## Features

- **Zero-cost disabled logs** -- `?.` short-circuits the entire call: no string interpolation, no JSON.stringify, no function evaluation. [~22x faster](https://loggily.dev/guide/benchmarks) than noop loggers.
- **Config pipeline** -- `createLogger("app", [config, console, { file }, stage, [branch]])`. Objects configure, arrays branch, values write.
- **Namespace hierarchy** -- `DEBUG=myapp:db` shows only database output. Same patterns as the `debug` package.
- **Spans** -- `using span = log.span("name")`. Duration, parent-child tracking, trace IDs, custom data. Control per-pipeline with `{ spans: true/false }`.
- **Dev & production** -- colorized console in development, structured JSON in production. Same code.
- **Child loggers** -- `log.child("auth")` extends namespace, `log.child({ requestId })` adds context.
- **Async context** -- `AsyncLocalStorage` propagation: every log in a request's async chain inherits trace/span IDs automatically.
- **Error cause chains** -- `log.error?.(err)` serializes `Error.cause` recursively (up to 3 levels).
- **Worker threads** -- pipeline-based: `createWorkerLogger(postMessage, "ns")` on worker, `createWorkerLogHandler()` on main. Same events, same pipeline.
- **OpenTelemetry bridge** -- `toOtel({ api })` stage forwards events to any OTLP backend. Transparent: events pass through to subsequent pipeline elements.
- **Pino transport compatible** -- works with object-mode writable sinks (compatible with Pino transport interface). Events use Loggily's record shape.
- **Span metrics** -- `{ metrics: true }` in config auto-creates a collector on `log.metrics` (p50/p95/p99). Or use `withMetrics(collector)` for shared/custom collectors.
- **Head-based sampling** -- `setSampleRate(0.1)` to sample 10% of traces.
- **Composable plugins** -- `pipe(baseCreateLogger, withSpans(), myPlugin())` to build custom factories.
- **Browser support** -- bundlers auto-select the browser entry point via `browser` condition.
- **~3 KB, zero dependencies.**

## Quick Start

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug" }, console])

log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("timeout"), "request failed", { url: "/api" })

// Child loggers
const dbLog = log.child("db", { pool: "main" }) // namespace: "myapp:db"

// Spans -- time any operation
{
  using span = dbLog.span("query", { table: "users" })
  const users = await queryUsers() // your DB call
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table: "users"}
```

## Complete Example

The config array accepts six element types -- here they are in one pipeline:

```typescript
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"
import * as otelApi from "@opentelemetry/api"

const log = createLogger("myapp", [
  // "myapp" -- namespace, filter with DEBUG=myapp
  { level: "debug", metrics: true }, // config object -- sets scope
  toOtel({ api: otelApi }), // stage -- transforms/forwards events
  pinoTransport, // writable -- { write } receives raw Events
  { file: "/tmp/app.log", format: "json" }, // file sink -- writes formatted strings
  [{ level: "error" }, { file: "/tmp/err.log" }], // branch -- sub-pipeline with own scope
  console, // console -- colorized, human-readable
])

// Custom writable -- any { write } receives raw Event objects
const log2 = createLogger("ingest", [
  {
    write: (event) =>
      fetch("/ingest", { method: "POST", body: JSON.stringify(event) }),
  },
  console,
])

// Custom stage -- functions transform, filter, or enrich events
const log3 = createLogger("filtered", [
  (event) =>
    event.kind === "log" && event.message.includes("secret") ? null : event,
  (event) => ({ ...event, props: { ...event.props, host: os.hostname() } }),
  console,
])

// Metrics -- { metrics: true } auto-creates a collector on log.metrics
for (const [name, s] of log.metrics.all()) {
  if (s.p95 > 100) console.warn(`${name} is slow: p95=${s.p95}ms`)
}
```

### Composition with plugins

`createLogger` is `pipe(baseCreateLogger, withEnvDefaults(), withSpans(), withConfigMetrics())`. For full manual control:

```typescript
import { baseCreateLogger, pipe, withSpans, withEnvDefaults } from "loggily"

// Custom factory — choose exactly which plugins to include
const myCreateLogger = pipe(baseCreateLogger, withSpans(), myPlugin())
const log = myCreateLogger("myapp", [console])
```

`baseCreateLogger` does NOT include `withSpans()` or `withEnvDefaults()` — loggers it creates cannot create spans and do not read environment variables.

### Test helper

```typescript
import { createTestLogger } from "loggily"
const log = createTestLogger("test") // all levels enabled, console output
```

### Environment variables

| Variable            | Values                                  | Default   |
| ------------------- | --------------------------------------- | --------- |
| `LOG_LEVEL`         | trace, debug, info, warn, error, silent | `info`    |
| `LOG_FORMAT`        | console, json                           | `console` |
| `LOG_FILE`          | file path                               | (none)    |
| `DEBUG`             | `*`, namespace prefixes, `-prefix`      | (none)    |
| `TRACE`             | `1`, `true`, namespace prefixes         | (none)    |
| `TRACE_FORMAT`      | json                                    | (none)    |
| `TRACE_ID_FORMAT`   | simple, w3c                             | `simple`  |
| `TRACE_SAMPLE_RATE` | 0.0 -- 1.0                              | `1.0`     |
| `NODE_ENV`          | production                              | (none)    |

### Namespace filter patterns

| Pattern            | Matches                                                        |
| ------------------ | -------------------------------------------------------------- |
| `*`                | Everything                                                     |
| `myapp`            | Exact match + children (`myapp`, `myapp:db`, `myapp:db:query`) |
| `myapp:*`          | Same as `myapp` — explicit wildcard                            |
| `-myapp:sql`       | Exclude `myapp:sql` and its children                           |
| `myapp,-myapp:sql` | Include myapp, exclude sql subtree                             |

### Types

Key types exported for power users:

| Type                | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `LogEvent`          | A log message event (kind, level, namespace, message, props)     |
| `SpanEvent`         | A span timing event (kind, namespace, duration, spanId, traceId) |
| `Event`             | `LogEvent \| SpanEvent`                                          |
| `Stage`             | `(event: Event) => Event \| null \| void`                        |
| `Pipeline`          | `{ dispatch, level, dispose }`                                   |
| `ConditionalLogger` | Logger with `?.`-compatible methods                              |
| `ConfigElement`     | Union of all valid config array elements                         |
| `ConfigObject`      | Scope config: `{ level?, ns?, format?, spans? }`                 |
| `FileDescriptor`    | File output: `{ file, level?, ns?, format? }`                    |
| `Writable`          | Any object with `{ write, objectMode? }`                         |

`buildPipeline()` is exported for direct pipeline construction.

### Subpath exports

| Import path       | Contents                                                             |
| ----------------- | -------------------------------------------------------------------- |
| `loggily`         | Core API, types, pipeline builder                                    |
| `loggily/context` | AsyncLocalStorage context propagation (Node.js)                      |
| `loggily/worker`  | Worker thread logger + message handlers                              |
| `loggily/otel`    | OpenTelemetry bridge (`toOtel` stage)                                |
| `loggily/metrics` | Span metrics collection (`{ metrics: true }` or explicit collectors) |

## Compatibility & Destinations

- **OpenTelemetry** -- `toOtel({ api })` forwards to Jaeger, Grafana, Datadog, or any OTLP backend
- **Sentry** -- capture errors via a 3-line stage function
- **Pino transports** -- works with object-mode writable sinks (compatible with Pino transport interface)
- **Elasticsearch / OpenSearch** -- post JSON events directly
- **AWS CloudWatch** -- writable calling `putLogEvents`
- **Prometheus** -- expose `log.metrics` as a `/metrics` endpoint
- **`DEBUG=` patterns** -- same namespace filter syntax as the `debug` package
- **W3C Trace Context** -- `traceparent()` generates standard headers
- **Browser** -- bundlers auto-select the browser entry point
- **Worker threads** -- pipeline-based forwarding via `postMessage`

See the [Destinations guide](https://loggily.dev/guide/destinations) for copy-paste recipes.

## Why this exists

Loggily was built while developing a terminal UI where disabled debug logs inside the render loop were eating frame time. No existing logger solved the "disabled calls should cost nothing" problem at the language level, so `?.` became the foundation.

> **Status:** Early release (0.x). The core API is stable, but details may evolve before 1.0.

## When not to use Loggily

- **You need auto-instrumentation** (HTTP, database, gRPC). Use OpenTelemetry's SDK directly -- Loggily's OTEL bridge forwards events but doesn't instrument frameworks.
- **You need log rotation, file compression, or dozens of transport plugins.** Pino's transport ecosystem is deeper. (You can use Pino transports with Loggily's `objectMode` writables, but Pino owns that ecosystem.)
- **You're not on a modern runtime.** Loggily requires Node.js >= 23.6 or Bun >= 1.0.

## Documentation

- **[Get Started](https://loggily.dev/guide/journey)** -- progressive guide from first log to full observability
- **[Full docs site](https://loggily.dev/)** -- guides, API reference, migration guides
- [Comparison](https://loggily.dev/guide/comparison) -- what Loggily does, compatibility, when to use something else
- [Migration from debug](https://loggily.dev/guide/migration-from-debug) -- step-by-step migration guide

## License

[MIT](LICENSE)
