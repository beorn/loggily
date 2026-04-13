# Loggily

Debugs, logs, and spans -- one API. Clarity without the clutter.

**Design philosophy**: Opinionated defaults, composable primitives. See [docs/guide/why.md](docs/guide/why.md#design-principles) for full principles.

## Documentation Site

VitePress docs at `docs/` -- deployed to loggily.dev via GitHub Pages.

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
const log = createLogger("myapp", [
  { level: "debug" },
  console,
  { file: "/tmp/app.log", format: "json" },
])

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

## Config Array

The second argument to `createLogger` is an optional config array. Objects configure, arrays branch, values write:

```typescript
const log = createLogger("myapp", [
  { level: "debug", ns: "-sql" }, // Config object: set level, filter namespace
  console, // Output: write to console
  { file: "/tmp/errors.log", level: "error", format: "json" }, // File sink
  (event) => {
    // Stage: custom transform/filter
    if (event.kind === "log" && event.message.includes("secret")) return null
    return event
  },
  { write: (event) => sendToService(event) }, // Writable sink (receives raw Events by default)
  [
    // Branch: sub-pipeline
    { ns: "myapp:metrics" },
    { file: "/tmp/metrics.log" },
  ],
])
```

### Config Array Element Discrimination

| Element Type   | Example                                                        | Description                         |
| -------------- | -------------------------------------------------------------- | ----------------------------------- |
| Config object  | `{ level: "debug", ns: "-sql", format: "json", spans: false }` | Set scope for subsequent elements   |
| `console`      | `console` or `"console"`                                       | Console output at current scope     |
| File sink      | `{ file: "/path", level?, ns?, format? }`                      | File output with optional overrides |
| Stage function | `(event) => event \| null \| void`                             | Transform, filter, or enrich events |
| Branch array   | `[{ ns: "metrics" }, { file: "/tmp/m.log" }]`                  | Sub-pipeline with own scope         |
| Writable       | `{ write: (data) => void, objectMode?: boolean }`              | Any writable stream or transport    |

### Config Object Keys

| Key          | Type                  | Description                                                |
| ------------ | --------------------- | ---------------------------------------------------------- |
| `level`      | `LogLevel`            | Minimum log level                                          |
| `ns`         | `string \| string[]`  | Namespace filter pattern                                   |
| `format`     | `"console" \| "json"` | Output format                                              |
| `spans`      | `boolean`             | Enable/disable span output (per-pipeline)                  |
| `metrics`    | `boolean`             | Auto-create MetricsCollector, accessible via `log.metrics` |
| `idFormat`   | `"simple" \| "w3c"`   | Trace/span ID format (default: `"simple"`)                 |
| `sampleRate` | `number` (0.0 -- 1.0) | Head-based trace sampling rate (default: `1.0`)            |

### Sink Object Keys (file sinks)

| Key      | Type                             | Description                   |
| -------- | -------------------------------- | ----------------------------- |
| `file`   | `string`                         | Path for file output          |
| `level`  | `LogLevel` (optional)            | Override level for this sink  |
| `ns`     | `string \| string[]` (optional)  | Override ns for this sink     |
| `format` | `"console" \| "json"` (optional) | Override format for this sink |

### Writable Object Mode

Writables receive raw `Event` objects by default. Node.js streams (`process.stderr`, fs streams) are auto-detected and receive formatted strings. Set `objectMode: false` to force string mode on a plain writable.

## Environment Variables

| Variable            | Values                                  | Default   | Effect                              |
| ------------------- | --------------------------------------- | --------- | ----------------------------------- |
| `LOG_LEVEL`         | trace, debug, info, warn, error, silent | `info`    | Filter output by level              |
| `DEBUG`             | \*, namespace prefixes, -prefix         | (none)    | Filter output by namespace          |
| `TRACE`             | 1, true, or namespace prefixes          | (none)    | Enable span output                  |
| `TRACE_FORMAT`      | json                                    | (none)    | Force JSON output                   |
| `TRACE_ID_FORMAT`   | simple, w3c                             | `simple`  | Trace/span ID format                |
| `TRACE_SAMPLE_RATE` | 0.0 -- 1.0                              | `1.0`     | Head-based trace sampling rate      |
| `LOG_FORMAT`        | console, json                           | `console` | Override output format              |
| `LOG_FILE`          | /path/to/file                           | (none)    | File output (default pipeline only) |
| `NODE_ENV`          | production                              | (none)    | Auto-enable JSON format             |

### Examples

```bash
LOG_LEVEL=debug bun run app         # Enable debug logging
DEBUG=km:storage bun run app        # Only show km:storage (+ children), auto-enables debug level
DEBUG='km:*,-km:sql' bun run app    # Show all km namespaces except km:sql
DEBUG='*' bun run app               # Show all namespaces at debug level
TRACE=1 bun run app                 # Enable all span timing output
TRACE=myapp:import bun run app      # Enable spans for specific namespace
```

### Namespace Filter Patterns

| Pattern            | Matches                                                        |
| ------------------ | -------------------------------------------------------------- |
| `*`                | Everything                                                     |
| `myapp`            | Exact match + children (`myapp`, `myapp:db`, `myapp:db:query`) |
| `myapp:*`          | Same as `myapp` -- explicit wildcard                           |
| `myapp:db`         | Exact match + children (`myapp:db`, `myapp:db:query`)          |
| `-myapp:sql`       | Exclude `myapp:sql` and its children                           |
| `myapp,-myapp:sql` | Include myapp, exclude sql subtree                             |

## API

### createLogger(name, config?)

Create a logger. Second argument is an optional config array.

```typescript
// Zero config
const log = createLogger("myapp")

// With config array
const log = createLogger("myapp", [{ level: "debug" }, console])
```

`createLogger` = `pipe(baseCreateLogger, withEnvDefaults(), withSpans(), withConfigMetrics())`.

### baseCreateLogger(name, config?)

Base logger factory without `withEnvDefaults()` or `withSpans()`. Use for full manual control:

```typescript
import { baseCreateLogger, pipe, withSpans, withEnvDefaults } from "loggily"

const myCreateLogger = pipe(baseCreateLogger, withEnvDefaults(), withSpans())
```

Loggers from `baseCreateLogger` do NOT have `.span()` capability -- calling `.span()` throws.

### Logger Methods

| Method                           | Purpose            |
| -------------------------------- | ------------------ |
| `.trace?(msg, data?)`            | Verbose debugging  |
| `.debug?(msg, data?)`            | Debug information  |
| `.info?(msg, data?)`             | Normal operation   |
| `.warn?(msg, data?)`             | Recoverable issues |
| `.error?(msg \| Error, data?)`   | Failures           |
| `.error?(error, message, data?)` | Error + custom msg |

**Log levels** (most to least verbose): `trace < debug < info < warn < error < silent`

**Default level**: `info` (trace and debug disabled)

### Error Overloads

```typescript
log.error?.(new Error("timeout")) // Error only
log.error?.(new Error("timeout"), "request failed") // Error + custom message
log.error?.(new Error("timeout"), "request failed", { url: "/api" }) // Error + message + data
log.error?.("manual error", { code: "ETIMEOUT" }) // String message + data
```

Error.cause chains are serialized automatically (up to 3 levels deep):

```typescript
const err = new Error("timeout")
err.cause = new Error("DNS failed")
log.error?.(err)
// props includes: error_cause: { name: "Error", message: "DNS failed", stack: "..." }
```

### Child Loggers

```typescript
// Extend namespace
const child = log.child("auth") // namespace: "myapp:auth"

// Context fields (same namespace, extra fields)
const child = log.child({ requestId: "abc" })

// Both at once
const child = log.child("auth", { sso: true })
// namespace: "myapp:auth", all logs include sso
```

`.child()` returns `ConditionalLogger`. The older `.logger()` still works but is deprecated.

### Spans

Spans are loggers with timing. They implement `Disposable` for use with `using`:

```typescript
{
  using span = log.span("operation", { context: "value" })
  span.debug?.("step 1")
  span.spanData.processed = 100
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
| `spanData.custom`    | any (writable)            | `span.spanData.key = value`           |

Control span output independently from logs:

```bash
TRACE=1 bun run app                  # All spans
TRACE=myapp:db bun run app           # Only database spans
```

### Plugin Composition

```typescript
import { baseCreateLogger, pipe, withSpans, withEnvDefaults } from "loggily"

// createLogger already includes withEnvDefaults() + withSpans() + withConfigMetrics()
// Pipe with custom plugins:
const myCreateLogger = pipe(createLogger, withSentry({ dsn: "..." }))

// Or build from scratch:
const customFactory = pipe(
  baseCreateLogger,
  withEnvDefaults(),
  withSpans(),
  myPlugin(),
)
```

`withEnvDefaults()` reads `LOG_LEVEL`, `DEBUG`, `LOG_FORMAT`, `TRACE`, etc. from env vars.

`withSpans()` enables `.span()` capability. Without it, `.span()` throws.

### Test Helper

```typescript
import { createTestLogger } from "loggily"
const log = createTestLogger("test") // all levels enabled, console output
```

### Pipeline Builder (power users)

```typescript
import { buildPipeline } from "loggily"
const pipeline = buildPipeline([
  { level: "debug" },
  console,
  { file: "/tmp/app.log", format: "json" },
])
```

## Subpath Exports

### `loggily/context` (Node.js only)

AsyncLocalStorage-based context propagation:

```typescript
import { enableContextPropagation, getCurrentSpan } from "loggily/context"

enableContextPropagation()

{
  using span = log.span("request")
  log.info?.("handling") // auto-tagged with trace_id/span_id
  getCurrentSpan() // { spanId, traceId, parentId }
}
```

| Export                                                       | Description                            |
| ------------------------------------------------------------ | -------------------------------------- |
| `enableContextPropagation()` / `disableContextPropagation()` | AsyncLocalStorage context control      |
| `isContextPropagationEnabled()`                              | Check if context propagation is active |
| `getCurrentSpan()`                                           | Get current span context               |
| `runInSpanContext(ctx, fn)`                                  | Run function in specific context       |

### `loggily/worker` (Node.js only)

Pipeline-based worker logging. Worker loggers use a postMessage transport stage so events flow through the main thread's pipeline for output.

```typescript
// worker.ts
import { createWorkerLogger } from "loggily/worker"
const log = createWorkerLogger(postMessage, "myapp:worker")

// main.ts
import { createWorkerLogHandler } from "loggily/worker"
worker.on("message", createWorkerLogHandler())
```

| Export                                        | Description                                  |
| --------------------------------------------- | -------------------------------------------- |
| `createWorkerLogger(postMessage, ns, props?)` | Logger for worker threads                    |
| `workerTransportStage(postMessage)`           | Pipeline stage that forwards via postMessage |
| `createWorkerLogHandler()`                    | Zero-config main thread handler              |
| `handleWorkerEvents(logger)`                  | Dispatch worker events to a specific logger  |
| `createWorkerConsoleHandler(opts?)`           | Console message handler                      |
| `forwardConsole(postMessage, ns?)`            | Forward console.\* from worker               |
| `restoreConsole()`                            | Restore original console methods             |
| `isWorkerMessage(msg)`                        | Type guard for any worker message            |
| `isWorkerEvent(msg)`                          | Type guard for LogEvent or SpanEvent         |
| `isWorkerLogEvent(msg)`                       | Type guard for LogEvent                      |
| `isWorkerSpanEvent(msg)`                      | Type guard for SpanEvent                     |
| `isWorkerConsoleMessage(msg)`                 | Type guard for WorkerConsoleMessage          |

### `loggily/otel`

OpenTelemetry bridge -- forwards events to OTLP-compatible backends:

```typescript
import * as otelApi from "@opentelemetry/api"
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"

const log = createLogger("myapp", [toOtel({ api: otelApi }), console])
```

| Export              | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `toOtel(options?)`  | Stage that forwards events to OpenTelemetry (transparent pass-through) |
| `OtelBridgeOptions` | Options: `api`, `loggerName`, `tracerName`, `logs`, `spans`            |

### `loggily/metrics`

Span metrics collection. Simple way via config:

```typescript
const log = createLogger("myapp", [{ level: "debug", metrics: true }, console])

log.metrics.stats("myapp:db") // SpanStats | undefined
log.metrics.summary() // formatted string
log.metrics.all() // Map<string, SpanStats>
```

Advanced way with explicit collector (for shared/custom collectors):

```typescript
import { withMetrics, createMetricsCollector } from "loggily/metrics"
const collector = createMetricsCollector()
const log = withMetrics(collector)(createLogger("myapp"))
// log.metrics === collector
```

## Key Types

```typescript
import type {
  LogEvent, // { kind: "log", time, namespace, level, message, props? }
  SpanEvent, // { kind: "span", time, namespace, name, duration, spanId, traceId, parentId, props? }
  Event, // LogEvent | SpanEvent
  Stage, // (event: Event) => Event | null | void
  Pipeline, // { dispatch, level, dispose }
  ConditionalLogger, // Logger with ?. methods
  ConfigElement, // Union of all valid config array elements
  ConfigObject, // Scope config: { level?, ns?, format?, spans? }
  FileDescriptor, // File output: { file, level?, ns?, format? }
  Writable, // Any object with { write, objectMode? }
} from "loggily"
```

## Deprecated API

These functions still work but are deprecated. They map to environment variables internally:

```typescript
// Deprecated -- use config array or env vars instead
setLogLevel("debug") // -> set LOG_LEVEL env var
enableSpans() // -> set TRACE=1 env var
setDebugFilter(["myapp"]) // -> set DEBUG env var
setTraceFilter(["myapp"]) // -> set TRACE env var
addWriter(fn) // -> use config array
setLogFormat("json") // -> set LOG_FORMAT env var
setIdFormat("w3c") // -> set TRACE_ID_FORMAT env var or { idFormat: "w3c" }
setSampleRate(0.1) // -> set TRACE_SAMPLE_RATE env var or { sampleRate: 0.1 }
  .logger("auth") // -> use .child("auth")
```

## Distributed Tracing (opt-in)

### ID Format

```bash
TRACE_ID_FORMAT=w3c bun run app   # env var (recommended)
```

```typescript
// Config object
const log = createLogger("myapp", [{ idFormat: "w3c" }, console])

// Deprecated setter
import { setIdFormat } from "loggily"
setIdFormat("w3c")
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

```bash
TRACE_SAMPLE_RATE=0.1 bun run app   # env var (recommended)
```

```typescript
// Config object
const log = createLogger("myapp", [{ sampleRate: 0.1 }, console])

// Deprecated setter
import { setSampleRate } from "loggily"
setSampleRate(0.1)
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
{
  "time": "2024-01-15T14:32:15.123Z",
  "level": "info",
  "name": "myapp",
  "msg": "starting"
}
```

## Browser Support

Loggily includes a browser-optimized entry point that excludes Node.js-specific features (file writers, `node:fs`). Bundlers automatically select it via the `browser` condition in package.json exports.

Features available in browser: logging, spans, child loggers, custom stages, tracing utilities, OpenTelemetry bridge.

Features Node.js only: file sinks (`{ file: ... }`), context propagation (`loggily/context`), worker threads (`loggily/worker`).

## Common Patterns

### Production setup with file + JSON + OTEL

```typescript
import * as otelApi from "@opentelemetry/api"
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"

const log = createLogger("myapp", [
  { level: "info", format: "json" },
  toOtel({ api: otelApi }), // forward to OTLP backend
  { file: "/var/log/app.log" }, // write JSON to file
  [{ level: "error" }, { file: "/var/log/errors.log" }], // errors to separate file
])
```

### Request handler with async context

```typescript
import { enableContextPropagation } from "loggily/context"
enableContextPropagation()

const log = createLogger("api")

async function handleRequest(req: Request) {
  using span = log.span("request", { method: req.method, url: req.url })

  // All logs in this async context auto-inherit trace_id/span_id
  const result = await processRequest(req) // child spans auto-parent
  span.spanData.status = result.status
  return result
}
```

### Pino transport as pipeline destination

```typescript
const log = createLogger("myapp", [
  pinoTransport, // any { write } receives raw Events by default
  console, // also print to console
])
```

### Metrics collection

```typescript
// Simple: { metrics: true } in config
const log = createLogger("myapp", [{ level: "debug", metrics: true }, console])

{
  using span = log.span("db:query")
  // ...
}

// After your app runs:
console.log(log.metrics.summary())
// myapp:db:query: 42 spans, mean=3.2ms, p50=2.1ms, p95=8.4ms, p99=12.1ms

// Advanced: explicit collector (for sharing across loggers)
import { withMetrics, createMetricsCollector } from "loggily/metrics"
const collector = createMetricsCollector()
const log2 = withMetrics(collector)(createLogger("myapp"))
// log2.metrics === collector
```

### Worker thread logging

```typescript
// worker.ts
import { createWorkerLogger } from "loggily/worker"
const log = createWorkerLogger(postMessage, "myapp:worker")
log.info?.("processing", { file: "data.csv" })
{
  using span = log.span("parse")
  span.spanData.lines = 100
}

// main.ts
import { createWorkerLogHandler } from "loggily/worker"
const handler = createWorkerLogHandler()
worker.on("message", (msg) => handler(msg))
```

### Custom pipeline stage (filter/transform/enrich)

```typescript
const log = createLogger("myapp", [
  // Filter: drop events matching a condition
  (event) => {
    if (event.kind === "log" && event.message.includes("secret")) return null
    return event
  },
  // Enrich: add fields to every event
  (event) => ({ ...event, props: { ...event.props, host: hostname() } }),
  console,
])
```

### Branching pipeline (different destinations per namespace/level)

```typescript
const log = createLogger("myapp", [
  { level: "debug" },
  console, // everything to console
  [{ ns: "myapp:metrics" }, { file: "/tmp/metrics.log", format: "json" }], // metrics branch
  [{ level: "error" }, { file: "/tmp/errors.log", format: "json" }], // errors branch
])
```

### W3C traceparent headers

```typescript
import { traceparent } from "loggily"

// Use W3C-format IDs via config (or TRACE_ID_FORMAT=w3c env var)
const log = createLogger("myapp", [{ idFormat: "w3c" }, console])

const span = log.span("outbound-request")
fetch(url, {
  headers: { traceparent: traceparent(span.spanData) },
})
```

## Best Practices

1. **Config array for explicit setup**: Use `createLogger("name", [config])` when you want explicit control
2. **Env vars for runtime control**: `LOG_LEVEL`, `DEBUG`, `TRACE`, `LOG_FORMAT` for runtime tunability
3. **Namespace hierarchy**: Use `:` to create hierarchy (`myapp:db:query`)
4. **Props for context**: Pass structured data, not string interpolation
5. **Spans for timing**: Wrap operations you want to measure
6. **Conditional logging**: Use `?.` pattern in hot paths to skip arg evaluation
7. **Custom stages**: Functions in the config array for transform/filter/enrich
