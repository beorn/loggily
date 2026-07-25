# Loggily at a Glance

What Loggily does, what it's compatible with, and how it fits alongside other tools.

## What Loggily Does

Loggily is a structured logging library with built-in spans and near-zero cost disabled logging via optional chaining (`?.`). It covers three use cases in one API:

1. **Structured logging** -- levels, JSON output, child loggers
2. **Debug-style namespace filtering** -- `DEBUG=myapp:db,-myapp:sql`
3. **Lightweight spans** -- `using span = log.span?.("op")` with automatic timing

The config array provides a composable pipeline model:

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [
  { level: "debug", ns: "-sql" },
  console,
  { file: "/tmp/app.log", level: "error", format: "json" },
])
```

Objects configure (`{ level, ns, format }`), arrays branch, values write. Custom stage functions can transform or filter events in the pipeline.

## Feature Overview

| Feature                | Loggily                                             |
| ---------------------- | --------------------------------------------------- |
| Log Levels             | 5 levels (trace through error)                      |
| Structured Logging     | JSON + pretty console                               |
| Near-zero Disabled     | `?.` skips arg evaluation entirely                  |
| Built-in Spans         | `using` keyword, auto timing                        |
| Namespace Filtering    | `DEBUG=` compatible patterns                        |
| Child / Context Logger | `.child()` — extend namespace, add context, or both |
| Output Pipeline        | Config array: objects, arrays, values               |
| Pretty Print           | Built-in (default)                                  |
| JSON Output            | Built-in (`LOG_FORMAT=json`)                        |
| File Output            | `{ file: "/path" }` in config array                 |
| Custom Stages          | `(event) => event \| null \| void`                  |
| Worker Threads         | `loggily/worker` with typed protocol                |
| Bundle Size            | ~3KB                                                |
| TypeScript             | Native, ESM-only                                    |
| Error Handling         | `log.error?.(err, "msg", data?)`                    |

## Compatibility

Loggily is designed to coexist with and interoperate with the broader Node.js ecosystem:

- **`DEBUG=` compatible** -- uses the same namespace filter patterns as the `debug` package. Existing `DEBUG=myapp:db,-myapp:noisy` environment variables work as-is.
- **Works with Pino transports** -- custom stage functions in the config array can forward `Event` objects to Pino transport destinations or any other sink.
- **Standard env vars** -- `LOG_LEVEL`, `LOG_FORMAT`, and `DEBUG` select logging behavior directly.
- **W3C Trace Context** -- `traceparent()` generates W3C-format headers for distributed tracing interop.
- **OpenTelemetry compatible** -- span events include `spanId`, `traceId`, and `parentId` fields that map directly to OTel concepts.

## When to Use Loggily

Loggily is a good fit when:

- Disabled log calls are on hot paths and you need argument evaluation to be skipped entirely
- You want debug-style namespace filtering integrated with structured logging
- You need lightweight span timing without a full tracing SDK
- Bundle size matters (browser, CLI tools, small services)
- You prefer a simple API with progressive disclosure over upfront configuration

## When to Use Something Else

- **You need a mature transport ecosystem with log rotation, remote destinations, and worker-thread pipelines.** Pino has a rich plugin ecosystem for this.
- **You need distributed tracing with vendor exporters, auto-instrumentation, and baggage propagation.** OpenTelemetry is the industry standard.
- **You need custom log level names or more than 5 levels.** Winston supports custom level definitions.

## API Comparison

### Logger creation

```typescript
// Loggily
import { createLogger } from "loggily"
const log = createLogger("myapp", [{ level: "debug" }, console])

// Pino
import pino from "pino"
const log = pino({ level: "debug" })

// Winston
import winston from "winston"
const log = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
})

// debug
import createDebug from "debug"
const debug = createDebug("myapp")
```

### Disabled log cost

```typescript
// Loggily -- args NOT evaluated when disabled
log.debug?.(`state: ${computeState()}`)

// Others -- args always evaluated, even when disabled
log.debug(`state: ${computeState()}`)
```

### Spans

```typescript
// Loggily -- built-in
{
  using span = log.span?.("db:query", { table: "users" })
  const users = await queryUsers() // your DB call
  if (span) span.spanData.count = users.length
}
// SPAN myapp:db:query (45ms) {count: 100, table: "users"}
```

### File output

```typescript
// Loggily -- config array
const log = createLogger("myapp", [
  console,
  { file: "/tmp/app.log", format: "json" },
])
```

### Error logging

```typescript
// Loggily -- Error object with optional message
log.error?.(new Error("timeout"))
log.error?.(new Error("timeout"), "request failed", { url: "/api" })

// Pino -- data-first style
logger.error({ err }, "request failed")

// Winston -- metadata style
logger.error("request failed", { error: err.message })
```

### Custom pipeline stages

```typescript
// Loggily -- functions in the config array
const log = createLogger("myapp", [
  // Enrich events
  (event) => ({ ...event, props: { ...event.props, host: hostname() } }),
  // Filter events
  (event) =>
    event.kind === "log" && event.message.includes("secret") ? null : event,
  console,
])
```

For power users, `buildPipeline()` is exported for direct pipeline construction.

## Coming from another logger?

Loggily is `DEBUG=` compatible (same namespace patterns as the `debug` package), accepts Pino transports via `objectMode` writables, and bridges to OpenTelemetry via `toOtel()`. Most migrations are straightforward — see the [API reference](/api/) for the full surface.
