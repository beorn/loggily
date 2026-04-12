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

Readable, colorized output in development:

```
14:32:15 INFO myapp server started {port: 3000}
14:32:15 DEBUG myapp cache hit {key: "user:42"}
14:32:15 ERROR myapp connection lost
```

Set `NODE_ENV=production` and the same calls emit structured JSON:

```json
{ "time": "2024-01-15T14:32:15.123Z", "level": "info", "name": "myapp", "msg": "server started", "port": 3000 }
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

- **Config pipeline** -- second arg to `createLogger` is a config array: objects configure (`{ level, ns, format, spans }`), arrays branch, values write. Pass `console` or `"console"` for terminal output, `{ file: "/path" }` for file output, or functions for custom stages.
- **Namespace hierarchy** -- organize logs with `:` separators. `DEBUG=myapp:db` shows only database output, compatible with the same patterns as the `debug` package.
- **Lightweight spans** -- time any operation with `using span = log.span("name")`. Automatic duration, parent-child tracking, and trace IDs. Control per-pipeline with `{ spans: true/false }`.
- **Dev & production** -- colorized console in development, structured JSON in production. Same code, zero config.
- **Child loggers** -- `log.child("auth")` extends namespace, `log.child({ requestId })` adds context fields, `log.child("auth", { sso: true })` does both.
- **Automatic async context** -- enable `AsyncLocalStorage`-based propagation and every log in a request's async chain inherits trace/span IDs without passing loggers around.
- **Lazy messages** -- `log.debug?.(() => expensiveString())` skips the function entirely when disabled.
- **Error overloads** -- `log.error?.(err)`, `log.error?.(err, "msg")`, and `log.error?.(err, "msg", data)`. Cause chains serialized automatically (up to 3 levels).
- **Worker threads** -- forward logs from workers to the main thread with full type safety.
- **OpenTelemetry bridge** -- `toOtel()` stage forwards events to OTLP-compatible backends.
- **Composable** -- `pipe(baseCreateLogger, withSpans(), withEnvDefaults())` to build custom factories.
- **Browser support** -- bundlers auto-select the browser entry point via `browser` condition in exports.

## Usage Walkthrough

### Zero config

```typescript
import { createLogger } from "loggily"
const log = createLogger("myapp")
log.info?.("started")
```

### Configured pipeline

The config array supports all element types:

```typescript
const log = createLogger("myapp", [
  // Config object — sets scope for subsequent elements
  { level: "debug", ns: "-sql", format: "json", spans: true },

  // Console output
  console,

  // File sink — with optional level/ns/format overrides
  { file: "/tmp/app.log", level: "info", format: "json" },

  // Stage function — transform, filter, or enrich events
  (event) => {
    if (event.kind === "log" && event.message.includes("secret")) return null
    return { ...event, props: { ...event.props, host: hostname() } }
  },

  // Branch array — sub-pipeline with own scope
  [{ level: "error" }, { file: "/tmp/errors.log", format: "json" }],

  // Writable — any object with a write method (Pino transports, streams)
  { write: (event) => sendToService(event), objectMode: true },
])
```

### Child loggers

```typescript
const authLog = log.child("auth") // namespace: "myapp:auth"
const reqLog = log.child({ requestId: "abc-123" }) // context fields
const dbLog = log.child("db", { pool: "main" }) // both
```

`.child()` is the canonical method. The older `.logger()` still works but is deprecated.

### Spans

```typescript
{
  using span = log.span("import", { file: "data.csv" })
  span.info?.("parsing")
  span.spanData.rows = 42
}
// SPAN myapp:import (15ms) {rows: 42, file: "data.csv"}
```

### Error overloads

```typescript
log.error?.(new Error("timeout")) // Error only
log.error?.(new Error("timeout"), "request failed") // Error + custom message
log.error?.(new Error("timeout"), "request failed", { url: "/api" }) // Error + message + data
log.error?.("manual error", { code: "ETIMEOUT" }) // String message + data
```

### Composition with plugins

`createLogger` is `pipe(baseCreateLogger, withEnvDefaults(), withSpans())`. For full manual control:

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

| Variable       | Values                                  | Default   |
| -------------- | --------------------------------------- | --------- |
| `LOG_LEVEL`    | trace, debug, info, warn, error, silent | `info`    |
| `LOG_FORMAT`   | console, json                           | `console` |
| `LOG_FILE`     | file path                               | (none)    |
| `DEBUG`        | `*`, namespace prefixes, `-prefix`      | (none)    |
| `TRACE`        | `1`, `true`, namespace prefixes         | (none)    |
| `TRACE_FORMAT` | json                                    | (none)    |
| `NODE_ENV`     | production                              | (none)    |

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

| Import path       | Contents                                        |
| ----------------- | ----------------------------------------------- |
| `loggily`         | Core API, types, pipeline builder               |
| `loggily/context` | AsyncLocalStorage context propagation (Node.js) |
| `loggily/worker`  | Worker thread logger + message handlers         |
| `loggily/otel`    | OpenTelemetry bridge (`toOtel` stage)           |
| `loggily/metrics` | Span metrics collection (ambient + explicit)    |

## Compatibility

- **`DEBUG=` compatible** -- uses the same namespace filter patterns as the `debug` package
- **Works with Pino transports** -- writable sinks with `objectMode: true` receive raw Event objects
- **W3C Trace Context** -- `traceparent()` generates standard trace headers
- **OpenTelemetry compatible** -- `toOtel()` stage forwards events to OTLP backends
- **Browser ready** -- bundlers auto-select the browser entry point

## Why this exists

Loggily was built while developing a terminal UI where disabled debug logs inside the render loop were eating frame time. No existing logger solved the "disabled calls should cost nothing" problem at the language level, so `?.` became the foundation.

> **Status:** Early release (0.x). The core API is stable, but details may evolve before 1.0.

## When not to use Loggily

- **You need worker-thread transport pipelines with log rotation and dozens of plugins.** Pino has a mature transport ecosystem for this.
- **You need distributed tracing with vendor exporters and auto-instrumentation.** OpenTelemetry is the industry standard.

## Documentation

- **[Get Started](https://loggily.dev/guide/journey)** -- progressive guide from first log to full observability
- **[Full docs site](https://loggily.dev/)** -- guides, API reference, migration guides
- [Comparison](https://loggily.dev/guide/comparison) -- what Loggily does, compatibility, when to use something else
- [Migration from debug](https://loggily.dev/guide/migration-from-debug) -- step-by-step migration guide

## License

[MIT](LICENSE)
