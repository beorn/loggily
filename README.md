# Loggily

**Clarity without the clutter.**

One library. One namespace tree. One output pipeline. For logs (structured JSON or console), debug(), and tracing spans. Near-zero overhead from disabled log levels. Pure TypeScript. ~3KB. Zero dependencies.

[![Tests](https://github.com/beorn/loggily/actions/workflows/test.yml/badge.svg)](https://github.com/beorn/loggily/actions/workflows/test.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> Early release (0.x) -- API may evolve before 1.0.

## Install

```bash
npm install loggily
```

| Requirement   | Version                                           |
| ------------- | ------------------------------------------------- |
| Node.js       | >= 23.6                                            |
| Bun           | 1.0+                                              |
| TypeScript    | 5.2+ (for `using`; `.end()` works on any version) |
| Module format | ESM-only                                          |
| Browser       | Supported via conditional export                  |

## Quick Start

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp")

// ?. skips the entire call — including argument evaluation — when the level is disabled
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))
```

Output in development (colorized with timestamps and clickable source lines):

```
14:32:15 INFO myapp server started {port: 3000}
14:32:15 DEBUG myapp cache hit {key: "user:42"}
14:32:15 ERROR myapp connection lost
```

Set `NODE_ENV=production` or `LOG_FORMAT=json` and the same code emits structured JSON:

```json
{ "time": "2024-01-15T14:32:15.123Z", "level": "info", "name": "myapp", "msg": "server started", "port": 3000 }
```

### Spans

Time operations with lightweight spans. Uses TC39 [Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management) (`using` requires TypeScript 5.2+ and runtime support). For other environments, call `.end()` manually:

```typescript
// With `using` (TS 5.2+, Bun 1.0+, Node 22+)
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// Output: SPAN myapp:db:query (45ms) {count: 100, table: "users"}

// Without `using` — works on any runtime
const span = log.span("db:query", { table: "users" })
try {
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
} finally {
  span.end()
}
```

## Why Loggily?

One API for debug-style namespace logging, structured JSON output, and lightweight spans. Many projects end up with separate tools for these -- **debug** for conditional output, **pino/winston** for production logs, a tracing SDK for timings -- with separate configs, formats, and APIs. Loggily integrates all three into one namespace tree, one output pipeline, one `?.` pattern.

### Near-zero cost for disabled logs

Most loggers waste work when logging is disabled. Even with a noop function, arguments are still evaluated:

```typescript
// Traditional — args are ALWAYS evaluated, even when debug is off
log.debug(`state: ${JSON.stringify(computeExpensiveState())}`)
```

Loggily uses optional chaining to skip the entire call — including argument evaluation:

```typescript
// Loggily — args are NOT evaluated when disabled
log.debug?.(`state: ${JSON.stringify(computeExpensiveState())}`)
```

For trivial arguments the difference is negligible. But for real-world logging — string interpolation, JSON serialization, state snapshots — optional chaining is typically **10x+ faster** because it skips the work entirely. The more expensive your arguments, the bigger the win.

> **Note**: The big performance advantage is specifically for disabled logging with expensive arguments, not universal logger throughput. Pino is optimized for high-throughput enabled JSON logging; Loggily's biggest advantage is skipping work when logs are disabled. See [benchmarks](https://beorn.codes/loggily/guide/benchmarks) for detailed numbers per scenario.

## Features

- **Namespace hierarchy** — organize logs with `:` separators. `log.logger("db")` creates `myapp:db`. Children inherit parent context.
- **Lightweight spans and trace IDs** — time any operation with `using span = log.span("name")`. Automatic duration, parent-child tracking, and trace IDs. For full OpenTelemetry interoperability with exporters and propagation, use OpenTelemetry.
- **Lazy messages** — `log.debug?.(() => expensiveString())` skips the function entirely when disabled.
- **Child context** — `log.child({ requestId })` adds structured fields to every message in the chain.
- **Dev & production** — colorized console with timestamps, level colors, and clickable source lines in development. Structured JSON in production. Switches automatically via `NODE_ENV` — same code, zero config.
- **File writer** — `addWriter()` + `createFileWriter()` for buffered file output with auto-flush.
- **Worker threads** — forward logs from workers to the main thread with full type safety (`loggily/worker`).
- **debug-compatible namespace filtering** — reads `DEBUG=myapp:*` just like the debug package. Easy migration from debug — see the [migration guide](https://beorn.codes/loggily/guide/migration-from-debug).

## When Not to Use Loggily

- **Max-throughput transport pipelines** — use [Pino](https://getpino.io/) for worker-thread transports, custom serializers, and log rotation.
- **Vendor/exporter interop** — use [OpenTelemetry](https://opentelemetry.io/) for distributed tracing with propagation, semantic conventions, and backend integrations.
- **Tiny dev-only namespace logs** — use [debug](https://github.com/debug-js/debug) if all you need is conditional dev output with zero ceremony.

## Documentation

- **[Get Started](https://beorn.codes/loggily/guide/journey)** — progressive guide from first log to full observability
- **[Full docs site](https://beorn.codes/loggily/)** — guides, API reference, migration guides
- [Comparison](https://beorn.codes/loggily/guide/comparison) — vs Pino, Winston, Bunyan, debug
- [Migration from debug](https://beorn.codes/loggily/guide/migration-from-debug) — step-by-step migration guide

## Environment Variables

| Variable       | Values                                  | Effect                                  |
| -------------- | --------------------------------------- | --------------------------------------- |
| `LOG_LEVEL`    | trace, debug, info, warn, error, silent | Minimum output level                    |
| `LOG_FORMAT`   | console, json                           | Output format                           |
| `DEBUG`        | `*`, namespace prefixes, `-prefix`      | Namespace filter (like `debug` package) |
| `TRACE`        | `1`, `true`, or namespace prefixes      | Enable span output                      |
| `TRACE_FORMAT` | json                                    | Force JSON for spans                    |
| `NODE_ENV`     | production                              | Auto-enable JSON format                 |

## API

| Function                                                               | Description                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `createLogger(name, props?)`                                           | Create a logger (disabled levels return `undefined` for `?.`) |
| `.trace?.()` / `.debug?.()` / `.info?.()` / `.warn?.()` / `.error?.()` | Log at level (message + optional data)                        |
| `.logger(namespace)`                                                   | Create child logger with extended namespace                   |
| `.span(namespace, props?)`                                             | Create timed span (implements `Disposable`)                   |
| `.child(context)`                                                      | Create child with structured context fields                   |
| `addWriter(fn)` / `createFileWriter(path)`                             | Custom output writers                                         |
| `setLogLevel()` / `setLogFormat()` / `enableSpans()`                   | Runtime configuration                                         |
| `createWorkerLogger()` / `createWorkerLogHandler()`                    | Worker thread support (`loggily/worker`)                      |

See the [full API reference](https://beorn.codes/loggily/api/) for all functions and options.

## License

[MIT](LICENSE)
