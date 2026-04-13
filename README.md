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
```

**Why the `?.`?** An [ergonomic and efficient](https://loggily.dev/guide/benchmarks) way to handle disabled logs — `?.` short-circuits the entire call, so nothing evaluates when the level is off. [~22x faster](https://loggily.dev/guide/benchmarks) than conventional noop loggers.

## Getting Started

```bash
npm install loggily
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

```bash
DEBUG=myapp:db bun app    # namespace hierarchy — same patterns as debug package
NODE_ENV=production       # same code, structured JSON output
TRACE=1                   # enable span output
```

Also supports [async context propagation](https://loggily.dev/guide/context), [worker threads](https://loggily.dev/guide/workers), and [browser](https://loggily.dev/guide/browser).

Works with: [OpenTelemetry](https://loggily.dev/guide/otel) (Jaeger, Grafana, Datadog, any OTLP backend) · [Pino transports](https://loggily.dev/guide/destinations#pino) · Sentry · Elasticsearch · AWS CloudWatch · Prometheus · [W3C Trace Context](https://loggily.dev/guide/tracing) · [`DEBUG=` patterns](https://loggily.dev/guide/namespaces)

See the [Destinations guide](https://loggily.dev/guide/destinations) for copy-paste recipes.

## Why this exists

Tired of choosing between logging and production performance. Wanted structured JSON for production AND beautiful colorized output for development, in both browser and terminal, without the overhead when logs are off.

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
