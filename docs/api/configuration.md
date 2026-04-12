# Configuration

## v2 Config Array (recommended)

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

| Key      | Type                  | Description              |
| -------- | --------------------- | ------------------------ |
| `level`  | `LogLevel`            | Minimum log level        |
| `ns`     | `string \| string[]`  | Namespace filter pattern |
| `format` | `"console" \| "json"` | Output format            |

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

## Environment Variables

When no config array is provided, `createLogger` uses `defaultPipeline()` which reads from environment variables:

| Variable       | Values                                  | Default   |
| -------------- | --------------------------------------- | --------- |
| `LOG_LEVEL`    | trace, debug, info, warn, error, silent | `info`    |
| `LOG_FORMAT`   | console, json                           | `console` |
| `LOG_FILE`     | file path                               | (none)    |
| `DEBUG`        | `*`, namespace prefixes, `-prefix`      | (none)    |
| `TRACE`        | `1`, `true`, namespace prefixes         | (none)    |
| `TRACE_FORMAT` | json                                    | (none)    |
| `NODE_ENV`     | production                              | (none)    |

## Pipeline Builder (power users)

```typescript
import { buildPipeline, defaultPipeline } from "loggily"

// Build a custom pipeline
const pipeline = buildPipeline([{ level: "debug" }, console, { file: "/tmp/app.log", format: "json" }])

// Get the default env-var-based pipeline
const defaultPipe = defaultPipeline()
```

## Deprecated v1 API

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
