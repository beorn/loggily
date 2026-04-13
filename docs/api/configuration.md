# Configuration

## Config Array

The second argument to `createLogger` is an optional config array that defines the output pipeline:

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [
  { level: "debug", ns: "-sql", format: "json" },
  console,
  { file: "/tmp/app.log", level: "error", format: "json" },
])
```

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

### Sink Object Keys

| Key      | Type                             | Description                   |
| -------- | -------------------------------- | ----------------------------- |
| `file`   | `string`                         | Path for file output          |
| `level`  | `LogLevel` (optional)            | Override level for this sink  |
| `ns`     | `string \| string[]` (optional)  | Override ns for this sink     |
| `format` | `"console" \| "json"` (optional) | Override format for this sink |

### Stage Functions

Functions in the config array are called for every event:

```typescript
type Stage = (event: Event) => Event | null | void
```

- Return the event (possibly modified) to pass it through
- Return `null` to filter it out
- Return `void`/`undefined` to pass the original event through

### Branch Arrays

Arrays in the config array create sub-pipelines with their own scope:

```typescript
const log = createLogger("myapp", [console, [{ ns: "myapp:metrics", format: "json" }, { file: "/tmp/metrics.log" }]])
```

## Namespace Filter Patterns

The `ns` config key and the `DEBUG` environment variable accept the same filter syntax:

| Pattern            | Matches                                                        |
| ------------------ | -------------------------------------------------------------- |
| `*`                | Everything                                                     |
| `myapp`            | Exact match + children (`myapp`, `myapp:db`, `myapp:db:query`) |
| `myapp:*`          | Same as `myapp` — explicit wildcard                            |
| `myapp:db`         | Exact match + children (`myapp:db`, `myapp:db:query`)          |
| `-myapp:sql`       | Exclude `myapp:sql` and its children                           |
| `myapp,-myapp:sql` | Include myapp, exclude sql subtree                             |

Patterns are comma-separated. Include patterns are matched first; if any include pattern matches, the namespace passes. Exclude patterns (prefixed with `-`) take priority over includes.

When no include patterns are specified, all namespaces pass (only excludes are applied). When include patterns are present, a namespace must match at least one include and no excludes.

```bash
DEBUG='*' bun run app                     # Everything
DEBUG=myapp bun run app                   # myapp and all children
DEBUG='myapp,-myapp:sql' bun run app      # myapp tree, excluding sql subtree
DEBUG='myapp:db,myapp:cache' bun run app  # Only db and cache subtrees
```

## Environment Variables

`console` literal and `"console"` string are both accepted as console sinks.

## withEnvDefaults

`createLogger` includes the `withEnvDefaults()` plugin by default. When no config array is provided, it reads from environment variables:

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

## Pipeline Builder (power users)

```typescript
import { buildPipeline } from "loggily"

// Build a custom pipeline
const pipeline = buildPipeline([{ level: "debug" }, console, { file: "/tmp/app.log", format: "json" }])
```

## Deprecated API

These functions still work but are deprecated. They map to environment variables internally:

```typescript
// All deprecated — use config array or env vars instead
setLogLevel(level: LogLevel): void     // -> LOG_LEVEL env var
getLogLevel(): LogLevel

setLogFormat(format: LogFormat): void  // -> LOG_FORMAT env var
getLogFormat(): LogFormat

enableSpans(): void                    // -> TRACE=1 env var
disableSpans(): void
spansAreEnabled(): boolean

setTraceFilter(ns: string[] | null): void  // -> TRACE env var
getTraceFilter(): string[] | null

setDebugFilter(ns: string[] | null): void  // -> DEBUG env var
getDebugFilter(): string[] | null

setOutputMode(mode: OutputMode): void  // -> omit console from config array
getOutputMode(): OutputMode

setSuppressConsole(value: boolean): void // -> omit console from config array
```

## Browser Support

Loggily includes a browser-optimized entry point that excludes Node.js-specific features (file writers, `node:fs`). Bundlers automatically select it via the `browser` condition in package.json exports.

Features available in browser: logging, spans, child loggers, custom stages, tracing utilities, OpenTelemetry bridge (`loggily/otel`).

Features Node.js only: file sinks (`{ file: ... }`), context propagation (`loggily/context`), worker threads (`loggily/worker`).

Calling `createFileWriter()` in a browser environment throws an error with a descriptive message.
