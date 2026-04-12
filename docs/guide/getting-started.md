# Getting Started

## Installation

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

## Create a Logger

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp")
```

The string argument is the **namespace** -- it appears in every log message and is used for filtering.

The optional second argument is a **config array** that controls output and behavior:

```typescript
const log = createLogger("myapp", [{ level: "debug" }, console, { file: "/tmp/app.log", format: "json" }])
```

In the config array: objects configure (`{ level, ns, format }`), arrays branch into sub-pipelines, and values write output. Pass `console` for terminal output, or `{ file: "/path" }` for file output.

When no config array is provided, loggily reads `LOG_LEVEL`, `DEBUG`, `LOG_FORMAT`, and `NODE_ENV` from the environment.

## Log Messages

Every log method accepts a message string and optional structured data:

```typescript
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42", ttl: 300 })
log.warn?.("rate limited", { remaining: 0, resetIn: 60 })
log.error?.(new Error("connection lost"))
log.error?.(new Error("timeout"), "request failed", { url: "/api" })
```

Notice the `?.` -- this is intentional. When a log level is disabled, the method returns `undefined`, and optional chaining skips the entire call including argument evaluation. This is the core performance feature of Loggily.

The `error` method has an overload: `log.error?.(err, "message", data?)` lets you provide a custom message alongside an Error object.

## Log Levels

From most to least verbose:

| Level    | Purpose               | Default |
| -------- | --------------------- | ------- |
| `trace`  | Hot path debugging    | Off     |
| `debug`  | Development debugging | Off     |
| `info`   | Normal operation      | **On**  |
| `warn`   | Recoverable issues    | On      |
| `error`  | Failures              | On      |
| `silent` | Disable all output    | --      |

Control via environment variable or in the config array:

```bash
LOG_LEVEL=debug bun run app     # Enable debug and above
LOG_LEVEL=error bun run app     # Only errors
```

```typescript
const log = createLogger("myapp", [{ level: "debug" }, console])
```

## Child Loggers

Build a namespace hierarchy with `.child()`:

```typescript
const log = createLogger("myapp")
const db = log.child("db") // namespace: "myapp:db"
const cache = log.child("cache") // namespace: "myapp:cache"

db.info?.("connected", { host: "localhost" })
// 14:32:15 INFO myapp:db connected {host: "localhost"}
```

`.child()` is the single method for all child logger creation. It returns `ConditionalLogger`, which supports the same `?.` pattern.

## Context Loggers

Add structured context that appears in every message:

```typescript
const reqLog = log.child({ requestId: "abc-123" })
reqLog.info?.("handling request")
// 14:32:15 INFO myapp handling request {requestId: "abc-123"}
```

Combine namespace and context in one call:

```typescript
const dbLog = log.child("db", { pool: "main" })
// namespace: "myapp:db", all logs include pool
```

## Shared Logger Across Modules

Create one configured logger and import it everywhere:

```typescript
// app/logger.ts
import { createLogger } from "loggily"
export const log = createLogger("myapp", [
  { level: "debug", ns: "-sql" },
  "console",
  { file: "/var/log/myapp.log", level: "info", format: "json" },
])

// app/auth.ts
import { log } from "./logger.ts"
const authLog = log.child("auth")
authLog.info?.("login attempted", { user: "alice" })
```

## Spans

Time any operation with `using`:

```typescript
{
  using span = log.span("import", { file: "data.csv" })
  span.info?.("parsing")
  const rows = await importFile()
  span.spanData.rowCount = rows.length
}
// SPAN myapp:import (1234ms) {rowCount: 500, file: "data.csv"}
```

Spans are disabled by default. Enable with:

```bash
TRACE=1 bun run app              # All spans
TRACE=myapp:import bun run app   # Specific namespace
```

See [Spans](/guide/spans) for the full guide.

## Namespace Filtering

Filter output by namespace, compatible with the same patterns as the `debug` package:

```bash
DEBUG=myapp bun run app                  # Only myapp and children
DEBUG='myapp,-myapp:noisy' bun run app   # Exclude noisy sub-namespace
DEBUG='*' bun run app                    # Everything
```

You can also use the `ns` key in the config array:

```typescript
const log = createLogger("myapp", [{ ns: "myapp:db,-myapp:db:verbose" }, console])
```

## Output Format

Pretty console in development, JSON in production:

```bash
# Development (default)
bun run app
# 14:32:15 INFO myapp server started {port: 3000}

# Production (automatic)
NODE_ENV=production bun run app
# {"time":"2026-01-15T14:32:15.123Z","level":"info","name":"myapp","msg":"server started","port":3000}

# Explicit
LOG_FORMAT=json bun run app
```

Or set the format in the config array:

```typescript
const log = createLogger("myapp", [{ format: "json" }, console])
```

## Pipeline Model

The v2 config array is a composable pipeline. Elements are processed in order:

- **Objects** (`{ level, ns, format }`) configure the scope for subsequent elements
- **`console`** adds console output at the current scope
- **`{ file: "/path" }`** adds file output (with optional `level`, `ns`, `format` overrides)
- **Functions** `(event) => event | null | void` are custom stages (transform, filter, or enrich events)
- **Arrays** create branches with their own scope

```typescript
const log = createLogger("myapp", [
  { level: "debug" },
  console,
  { file: "/tmp/errors.log", level: "error", format: "json" },
  [{ ns: "myapp:metrics" }, { file: "/tmp/metrics.log", format: "json" }],
])
```

For power users, `buildPipeline()` is exported for direct pipeline construction.

## Composition

Extend `createLogger` with custom plugins using `pipe`:

```typescript
import { createLogger, pipe } from "loggily"

const myCreateLogger = pipe(createLogger, withSentry({ dsn: "..." }))
const log = myCreateLogger("myapp")
```

`createLogger` already includes `withEnvDefaults()`, which reads `LOG_LEVEL`, `DEBUG`, `LOG_FORMAT`, and `TRACE` from environment variables.

## Test Helper

For tests, `createTestLogger` creates a logger with all levels enabled:

```typescript
import { createTestLogger } from "loggily"
const log = createTestLogger("test") // all levels, console output
```

## Next Steps

- [Near-Zero Cost Logging](/guide/zero-overhead) -- How optional chaining works and benchmarks
- [Spans](/guide/spans) -- Timing, nesting, trace IDs
- [Worker Threads](/guide/workers) -- Forward logs from workers
- [API Reference](/api/) -- Complete API documentation
