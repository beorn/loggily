# Loggily

**Clarity without the clutter.**

Debugs, logs, and spans — one API.

[![Tests](https://github.com/beorn/loggily/actions/workflows/test.yml/badge.svg)](https://github.com/beorn/loggily/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/loggily.svg)](https://www.npmjs.com/package/loggily)
[![size](https://img.shields.io/bundlephobia/minzip/loggily)](https://bundlephobia.com/package/loggily)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Most apps end up with three logging tools: `debug` for local troubleshooting, a JSON logger like Pino for production, and ad-hoc timers or a tracing SDK for performance. Three APIs, three configs, three output formats.

Loggily replaces all three with one namespace tree and one output pipeline. Pure TypeScript, zero dependencies, ~3 KB.

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp")

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

In benchmarks with expensive disabled log arguments, this is [~22x faster](https://beorn.codes/loggily/guide/benchmarks) than a conventional noop logger.

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

- **Namespace hierarchy** — organize logs with `:` separators. `DEBUG=myapp:db` shows only database output, just like the `debug` package.
- **Lightweight spans** — time any operation with `using span = log.span("name")`. Automatic duration, parent-child tracking, and trace IDs.
- **Dev & production** — colorized console in development, structured JSON in production. Same code, zero config.
- **Child context** — `log.child({ requestId })` adds structured fields to every message in the chain.
- **Automatic async context** — enable `AsyncLocalStorage`-based propagation and every log in a request's async chain inherits trace/span IDs without passing loggers around.
- **Lazy messages** — `log.debug?.(() => expensiveString())` skips the function entirely when disabled.
- **File writer** — `addWriter()` + `createFileWriter()` for buffered file output.
- **Worker threads** — forward logs from workers to the main thread with full type safety.

### Spans

```typescript
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// SPAN myapp:db:query (45ms) {count: 100, table: "users"}

// Without `using` — call .end() manually
const span = log.span("db:query")
try {
  /* ... */
} finally {
  span.end()
}
```

### Common configuration

| Variable     | Example                   | Effect                                                |
| ------------ | ------------------------- | ----------------------------------------------------- |
| `DEBUG`      | `myapp:db,-myapp:sql`     | Namespace filter (same syntax as the `debug` package) |
| `LOG_LEVEL`  | `debug`, `info`, `warn`   | Minimum output level                                  |
| `LOG_FORMAT` | `console`, `json`         | Override output format                                |
| `TRACE`      | `1` or namespace prefixes | Enable span output                                    |

See the [full environment variable reference](https://beorn.codes/loggily/api/configuration).

## Why this exists

Loggily was built while developing a terminal UI where disabled debug logs inside the render loop were eating frame time. No existing logger solved the "disabled calls should cost nothing" problem at the language level, so `?.` became the foundation.

> **Status:** Early release (0.x). The core API is stable, but details may evolve before 1.0.

## When not to use Loggily

- **You need the absolute fastest structured logger with a transport ecosystem.** Use [Pino](https://getpino.io/) for worker-thread transports, custom serializers, and log rotation.
- **You need distributed tracing with vendor exporters and auto-instrumentation.** Use [OpenTelemetry](https://opentelemetry.io/).

## Documentation

- **[Get Started](https://beorn.codes/loggily/guide/journey)** — progressive guide from first log to full observability
- **[Full docs site](https://beorn.codes/loggily/)** — guides, API reference, migration guides
- [Comparison](https://beorn.codes/loggily/guide/comparison) — vs Pino, Winston, Bunyan, debug
- [Migration from debug](https://beorn.codes/loggily/guide/migration-from-debug) — step-by-step migration guide

## License

[MIT](LICENSE)
