[![Tests](https://github.com/beorn/loggily/actions/workflows/test.yml/badge.svg)](https://github.com/beorn/loggily/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/loggily.svg)](https://www.npmjs.com/package/loggily)
[![size](https://img.shields.io/bundlephobia/minzip/loggily)](https://bundlephobia.com/package/loggily)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

# Loggily — Clarity without the clutter

Debugs, logs, and spans — one API. Replace `debug` + your JSON logger + ad-hoc timers with one namespace tree and one output pipeline. Pure TypeScript, zero dependencies, ~3 KB.

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
  const users = await queryUsers()
  span.spanData.count = users.length
}
// → SPAN myapp:db:query (45ms) {count: 100, table: "users"}
```

## Why the `?.`

Optional chaining is an ergonomic and efficient way to handle disabled logs. Most loggers still evaluate arguments even when the level is off — Loggily short-circuits the entire call:

```typescript
// Most loggers — computeExpensiveState() runs even when debug is off
log.debug(`state: ${JSON.stringify(computeExpensiveState())}`)

// Loggily — nothing runs when debug is off
log.debug?.(`state: ${JSON.stringify(computeExpensiveState())}`)
```

[~22x faster](https://loggily.dev/guide/benchmarks) than a conventional noop logger in benchmarks with expensive disabled arguments.

## Install

```bash
npm install loggily
```

## Config Pipeline

The second argument is an array where each element type has a distinct role:

```typescript
const log = createLogger("myapp", [
  { level: "debug", metrics: true },     // config object — sets scope
  toOtel({ api: otelApi }),              // stage — transforms/forwards
  pinoTransport,                         // writable — { write } receives events
  { file: "...", format: "json" },       // file sink — formatted strings
  [{ level: "warn" }, { file: "..." }],  // branch — sub-pipeline with own scope
  console,                               // console — colorized, human-readable
])
```

Objects configure, arrays branch, values write. [Full guide →](https://loggily.dev/guide/config-array)

## Features

- **Ergonomic and efficient** — free if silenced: `?.` short-circuits the entire call. [~22x faster](https://loggily.dev/guide/benchmarks) than noop loggers.
- **Namespace hierarchy** — `DEBUG=myapp:db` shows only database output. Same filter patterns as the `debug` package.
- **Spans** — `using span = log.span("name")`. Duration, parent-child tracking, trace IDs, custom data. Built-in [metrics collection](https://loggily.dev/guide/metrics) (p50/p95/p99).
- **Child loggers** — `log.child("auth")` extends namespace, `log.child({ requestId })` adds context.
- **Async context** — [AsyncLocalStorage propagation](https://loggily.dev/guide/context): every log in a request's async chain inherits trace/span IDs automatically.
- **OpenTelemetry bridge** — [`toOtel({ api })`](https://loggily.dev/guide/otel) forwards events to any OTLP backend (Jaeger, Grafana, Datadog). Transparent pass-through.
- **Worker threads** — [pipeline-based forwarding](https://loggily.dev/guide/workers) via `postMessage`. Same events, same pipeline.
- **Dev & production** — colorized console in development, structured JSON in production (`NODE_ENV=production`). Same code.
- **Composable plugins** — `pipe(baseCreateLogger, withSpans(), myPlugin())` to build custom factories.
- **~3 KB, zero dependencies.**

### Compatibility

Works with: [OpenTelemetry](https://loggily.dev/guide/otel) (Jaeger, Grafana, Datadog, any OTLP backend) · [Pino transports](https://loggily.dev/guide/destinations#pino) (object-mode writables) · Sentry · Elasticsearch / OpenSearch · AWS CloudWatch · Prometheus (`log.metrics`) · [W3C Trace Context](https://loggily.dev/guide/tracing) (`traceparent()`) · [`DEBUG=` patterns](https://loggily.dev/guide/namespaces) · Browser · Worker threads

See the [Destinations guide](https://loggily.dev/guide/destinations) for copy-paste recipes.

## Why this exists

Loggily was built while developing a terminal UI where disabled debug logs inside the render loop were eating frame time. No existing logger solved the "disabled calls should cost nothing" problem at the language level, so `?.` became the foundation.

> **Status:** Early release (0.x). The core API is stable, but details may evolve before 1.0.

## Requirements

Node.js ≥ 23.6 or Bun ≥ 1.0. ESM-only. TypeScript 5.2+ for `using` (`.end()` works on any version). [Browser supported](https://loggily.dev/guide/browser) via conditional export.

## When not to use Loggily

- **You need auto-instrumentation** (HTTP, database, gRPC). Use OpenTelemetry's SDK directly — Loggily's bridge forwards events but doesn't instrument frameworks.
- **You need log rotation or dozens of transport plugins.** Pino's transport ecosystem is deeper.

## Documentation

- **[Get Started](https://loggily.dev/guide/journey)** — progressive guide from first log to full observability
- **[Full docs](https://loggily.dev/)** — guides, API reference, migration guides
- [Comparison](https://loggily.dev/guide/comparison) — what Loggily does, compatibility, when to use something else
- [Migration from debug](https://loggily.dev/guide/migration-from-debug) — step-by-step guide

## License

[MIT](LICENSE)
