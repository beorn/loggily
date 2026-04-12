# Loggily

Debugs, logs, and spans -- one API. Clarity without the clutter.

**Design philosophy**: Opinionated defaults, composable primitives. See [docs/guide/why.md](docs/guide/why.md#design-principles) for full principles.

## Documentation Site

VitePress docs at `docs/` -- deployed to beorn.github.io/loggily via GitHub Pages.

- **Source**: `docs/` (edit files here)
- **Config**: `docs/.vitepress/config.ts`
- **Build**: `bun run docs:build` (runs `vitepress build docs`)
- **Build output**: `docs/.vitepress/dist/` (gitignored)
- **Logo**: `docs/public/logo.svg`
- **CI**: `.github/workflows/docs.yml` -- auto-deploys on push to main

**Do NOT create or edit `docs/site/`** -- docs live directly in `docs/`.

## Quick Start

```typescript
import { createLogger } from "loggily"

// Zero config (reads LOG_LEVEL, DEBUG, LOG_FORMAT from env)
const log = createLogger("myapp")

// Or with explicit config array
const log = createLogger("myapp", [{ level: "debug" }, console, { file: "/tmp/app.log", format: "json" }])

log.info?.("starting")
log.error?.(new Error("failed"))
log.error?.(new Error("timeout"), "request failed", { url: "/api" })

// Spans for timing (implements Disposable)
{
  using span = log.span("import", { file: "data.csv" })
  span.info?.("working...")
  span.spanData.count = 42
}
// -> SPAN myapp:import (15ms) {count: 42, file: "data.csv"}
```

## v2 Config Array

The second argument to `createLogger` is an optional config array. Objects configure, arrays branch, values write:

```typescript
const log = createLogger("myapp", [
  { level: "debug", ns: "-sql" }, // Config: set level, filter namespace
  console, // Output: write to console
  { file: "/tmp/errors.log", level: "error", format: "json" }, // Output: file sink
  (event) => {
    // Stage: custom transform/filter
    if (event.kind === "log" && event.message.includes("secret")) return null
    return event
  },
  [
    { ns: "myapp:metrics" }, // Branch: sub-pipeline
    { file: "/tmp/metrics.log" },
  ],
])
```

Config keys: `level` (LogLevel), `ns` (namespace filter string/array), `format` ("console" | "json"), `spans` (boolean, per-pipeline span control).

Sink keys: `file` (path string), with optional `level`, `ns`, `format` overrides.

`console` literal and `"console"` string are both accepted as console sinks.

When no config array is provided, `withEnvDefaults` reads from environment variables.

## Environment Variables

| Variable     | Values                                  | Effect                              |
| ------------ | --------------------------------------- | ----------------------------------- |
| LOG_LEVEL    | trace, debug, info, warn, error, silent | Filter output by level              |
| DEBUG        | \*, namespace prefixes, -prefix         | Filter output by namespace          |
| TRACE        | 1, true, or namespace prefixes          | Enable span output                  |
| TRACE_FORMAT | json                                    | Force JSON output                   |
| LOG_FORMAT   | console, json                           | Override output format              |
| LOG_FILE     | /path/to/file                           | File output (default pipeline only) |
| NODE_ENV     | production                              | Auto-enable JSON format             |

### Examples

```bash
LOG_LEVEL=debug bun run app         # Enable debug logging
DEBUG=km:storage bun run app        # Only show km:storage (+ children), auto-enables debug level
DEBUG='km:*,-km:sql' bun run app    # Show all km namespaces except km:sql
DEBUG='*' bun run app               # Show all namespaces at debug level
TRACE=1 bun run app                 # Enable all span timing output
TRACE=myapp:import bun run app      # Enable spans for specific namespace
TRACE=myapp,other bun run app       # Enable spans for multiple prefixes
```

## API

### createLogger(name, config?)

Create a logger. Second argument is an optional config array.

```typescript
// Zero config
const log = createLogger("myapp")

// With config array
const log = createLogger("myapp", [{ level: "debug" }, console])
```

### Logger Methods

| Method                           | Purpose            |
| -------------------------------- | ------------------ |
| `.trace?(msg, data?)`            | Verbose debugging  |
| `.debug?(msg, data?)`            | Debug information  |
| `.info?(msg, data?)`             | Normal operation   |
| `.warn?(msg, data?)`             | Recoverable issues |
| `.error?(msg \| Error, data?)`   | Failures           |
| `.error?(error, message, data?)` | Error + custom msg |

### Child Loggers

```typescript
// Extend namespace
const child = log.child("auth")
// -> namespace: "myapp:auth"

// Context fields (same namespace, extra fields)
const child = log.child({ requestId: "abc" })
// -> all logs include requestId

// Both at once
const child = log.child("auth", { sso: true })
// -> namespace: "myapp:auth", all logs include sso
```

`.child()` returns `ConditionalLogger`. The older `.logger()` still works but is deprecated.

### Spans

Spans are loggers with timing. They implement `Disposable` for use with `using`:

```typescript
{
  using span = log.span("operation", { context: "value" })
  span.debug?.("step 1")
  span.spanData.processed = 100 // Set custom attributes
}
// On block exit: SPAN myapp:operation (15ms) {processed: 100, context: "value"}
```

For environments without `using` support, call `.end()` manually:

```typescript
const span = log.span("operation")
try {
  span.info?.("working...")
  span.spanData.count = 42
} finally {
  span.end()
}
```

### Span Data

| Property             | Type                      | Description                           |
| -------------------- | ------------------------- | ------------------------------------- |
| `spanData.id`        | string (readonly)         | Unique span ID (sp_1, sp_2...)        |
| `spanData.traceId`   | string (readonly)         | Trace ID (shared across nested spans) |
| `spanData.parentId`  | string \| null (readonly) | Parent span ID                        |
| `spanData.startTime` | number (readonly)         | Start timestamp (ms)                  |
| `spanData.duration`  | number (readonly)         | Live duration since start             |
| `spanData.custom`    | any (writable)            | Set custom attributes                 |

### Key Types

```typescript
import type {
  LogEvent, // { kind: "log", time, namespace, level, message, props? }
  SpanEvent, // { kind: "span", time, namespace, name, duration, spanId, traceId, parentId, props? }
  Event, // LogEvent | SpanEvent
  Stage, // (event: Event) => Event | null | void
  Pipeline, // { dispatch, level, dispose }
  ConditionalLogger, // Logger with ?.  methods
} from "loggily"
```

### Composition

```typescript
import { createLogger, pipe, withEnvDefaults } from "loggily"

// createLogger already includes withEnvDefaults()
// Pipe with custom plugins:
const myCreateLogger = pipe(createLogger, withSentry({ dsn: "..." }))
```

`withEnvDefaults()` is the plugin that reads `LOG_LEVEL`, `DEBUG`, `LOG_FORMAT`, `TRACE`, etc. from env vars. It's included by default in `createLogger`. Omit it when composing from scratch for full manual control.

### Test Helper

```typescript
import { createTestLogger } from "loggily"
const log = createTestLogger("test") // all levels enabled, console output
```

### Pipeline Builder (power users)

```typescript
import { buildPipeline } from "loggily"

const pipeline = buildPipeline([{ level: "debug" }, console, { file: "/tmp/app.log", format: "json" }])
```

### Deprecated v1 API

These functions still work but are deprecated. They map to environment variables internally:

```typescript
// Deprecated -- use config array or env vars instead
setLogLevel("debug") // -> set LOG_LEVEL env var
enableSpans() // -> set TRACE=1 env var
setDebugFilter(["myapp"]) // -> set DEBUG env var
setTraceFilter(["myapp"]) // -> set TRACE env var
addWriter(fn) // -> use config array
setLogFormat("json") // -> set LOG_FORMAT env var
```

## Distributed Tracing (opt-in)

### ID Format

```typescript
import { setIdFormat, getIdFormat } from "loggily"

setIdFormat("simple") // sp_1, tr_1 (default)
setIdFormat("w3c") // 16-char hex span, 32-char hex trace (W3C Trace Context)
```

### traceparent Header

```typescript
import { traceparent } from "loggily"

const span = log.span("http-request")
const header = traceparent(span.spanData)
// -> "00-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1a2b3c4d5e6f7a8b-01"
fetch(url, { headers: { traceparent: header } })
```

### Sampling

```typescript
import { setSampleRate, getSampleRate } from "loggily"

setSampleRate(0.1) // Sample 10% of traces (head-based)
setSampleRate(1.0) // Sample everything (default)
```

### Context Propagation (Node.js/Bun only)

```typescript
import { enableContextPropagation, getCurrentSpan } from "loggily/context"

enableContextPropagation()

const log = createLogger("myapp")
{
  using span = log.span("request")
  // Logs auto-tagged with trace_id/span_id
  log.info?.("handling") // includes trace_id, span_id in output

  // Child spans from ANY logger auto-parent via AsyncLocalStorage
  const other = createLogger("db")
  const dbSpan = other.span("query") // parentId = span.id

  getCurrentSpan() // { spanId, traceId, parentId }
}
```

## Output Format

### Console (development)

```
14:32:15 INFO myapp starting
14:32:15 DEBUG myapp:import loading {file: "data.csv"}
14:32:16 SPAN myapp:import (1234ms) {count: 42}
```

### JSON (production / LOG_FORMAT=json)

```json
{"time":"2024-01-15T14:32:15.123Z","level":"info","name":"myapp","msg":"starting"}
{"time":"2024-01-15T14:32:16.456Z","level":"span","name":"myapp:import","msg":"(1234ms)","duration":1234,"count":42}
```

## Zero-Overhead Pattern (Optional Chaining)

`createLogger` returns a `ConditionalLogger` where disabled log levels return `undefined`.

**Log levels** (most to least verbose): `trace < debug < info < warn < error < silent`
**Default level**: `info` (trace and debug disabled)

```typescript
import { createLogger } from "loggily"

const log = createLogger("km:tui")

// All methods support ?. for zero-overhead when their level is disabled
log.trace?.(`very verbose: ${expensiveDebug()}`) // Skipped at default (info)
log.debug?.(`state: ${getState()}`) // Skipped at default (info)
log.info?.("starting") // Enabled at default (info)
log.warn?.("deprecated") // Enabled at default
log.error?.("failed") // Enabled at default
```

### Why optional chaining?

**Benchmark results** (10M iterations, Bun 1.1.x):

| Scenario                  | ops/s    | ns/op   | Notes                               |
| ------------------------- | -------- | ------- | ----------------------------------- |
| noop (cheap args)         | 2168M    | 0.5     | Fastest for trivial args            |
| `?.` (cheap args)         | 1406M    | 0.7     | ~0.2ns overhead - negligible        |
| noop (expensive args)     | 17M      | 57.6    | Args still evaluated - wasted!      |
| **`?.` (expensive args)** | **408M** | **2.5** | Args NOT evaluated - **22x faster** |

**Key insight**: Optional chaining is only ~0.2ns slower for cheap args, but **22x faster** for expensive args because it skips argument evaluation entirely.

- `log.debug?.()` skips the entire call including argument evaluation when debug is disabled
- TypeScript enforces `?.` at compile time (methods are typed as possibly undefined)
- Main benefit: expensive string formatting and function calls are completely skipped

See the internal research doc for detailed methodology and external references.

## Lazy Messages

Messages can be functions -- only called when the log level is enabled:

```typescript
log.debug?.(() => `expensive: ${JSON.stringify(bigObject)}`)
// Function never called when debug is disabled
```

Type: `LazyMessage = string | (() => string)`

## Child Loggers

`.child()` is the single method for creating child loggers:

```typescript
// Extend namespace
const authLog = log.child("auth")          // namespace: "myapp:auth"

// Add context fields (same namespace)
const reqLog = log.child({ requestId: "abc-123", userId: 42 })
reqLog.info?.("handling request")
// -> 14:32:15 INFO myapp handling request {requestId: "abc-123", userId: 42}

// Both: extend namespace + add fields
const dbLog = log.child("db", { pool: "main" })
```

## JSON Output Format

```bash
LOG_FORMAT=json bun run app   # Force JSON output in any environment
```

In addition to `TRACE_FORMAT=json` and `NODE_ENV=production`, `LOG_FORMAT=json` explicitly enables structured JSON output.

## Best Practices

1. **Config array for explicit setup**: Use `createLogger("name", [config])` when you want explicit control
2. **Env vars for runtime control**: `LOG_LEVEL`, `DEBUG`, `TRACE`, `LOG_FORMAT` for runtime tunability
3. **Namespace hierarchy**: Use `:` to create hierarchy (`myapp:db:query`)
4. **Props for context**: Pass structured data, not string interpolation
5. **Spans for timing**: Wrap operations you want to measure
6. **Conditional logging**: Use `?.` pattern in hot paths to skip arg evaluation
7. **Custom stages**: Functions in the config array for transform/filter/enrich
