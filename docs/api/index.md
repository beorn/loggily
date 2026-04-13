# API Reference

## Exports from `loggily`

### Core

| Export                            | Description                                                            |
| --------------------------------- | ---------------------------------------------------------------------- |
| `createLogger(name, config?)`     | Create a conditional logger (includes `withEnvDefaults`)               |
| `baseCreateLogger(name, config?)` | Base logger factory without `withEnvDefaults` — for manual composition |
| `createTestLogger(name)`          | Test helper — all levels enabled, console output                       |
| `pipe(base, ...plugins)`          | Pipe a logger factory through plugins (left-to-right)                  |
| `withEnvDefaults()`               | Plugin: read defaults from env vars (included by default)              |

`baseCreateLogger` does NOT include `withSpans()` or `withEnvDefaults()`. Use it when you want full manual control over plugin composition:

```typescript
import { baseCreateLogger, pipe, withSpans, withEnvDefaults } from "loggily"

// Manual composition — choose exactly which plugins to include
const myCreateLogger = pipe(baseCreateLogger, withSpans(), withEnvDefaults())
```

### Config Array Elements

The second argument to `createLogger` is an optional config array:

| Element Type   | Example                                                        | Description                         |
| -------------- | -------------------------------------------------------------- | ----------------------------------- |
| Config object  | `{ level: "debug", ns: "-sql", format: "json", spans: false }` | Set scope for subsequent elements   |
| `console`      | `console` or `"console"`                                       | Console output at current scope     |
| File sink      | `{ file: "/path", level?, ns?, format? }`                      | File output with optional overrides |
| Stage function | `(event) => event \| null \| void`                             | Transform, filter, or enrich events |
| Branch array   | `[{ ns: "metrics" }, { file: "/tmp/m.log" }]`                  | Sub-pipeline with own scope         |
| Writable       | `{ write: (s: string) => void }`                               | Any writable stream                 |

### Pipeline (power users)

| Export                                   | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| `buildPipeline(elements, parentConfig?)` | Build a pipeline from config array elements |

### Testing

| Export                                          | Description                    |
| ----------------------------------------------- | ------------------------------ |
| `createTestLogger(name)`                        | All levels, console output     |
| `startCollecting()` / `stopCollecting()`        | Collect span data for analysis |
| `getCollectedSpans()` / `clearCollectedSpans()` | Access collected spans         |
| `resetIds()`                                    | Reset span/trace ID counters   |

### Tracing

| Export                                    | Description                        |
| ----------------------------------------- | ---------------------------------- |
| `setIdFormat(format)` / `getIdFormat()`   | ID format (`"simple"` or `"w3c"`)  |
| `traceparent(spanData, opts?)`            | Format W3C traceparent header      |
| `setSampleRate(rate)` / `getSampleRate()` | Head-based sampling rate (0.0-1.0) |

### Types

| Export               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `Logger`             | Full logger interface                                               |
| `SpanLogger`         | Logger + Disposable + SpanData                                      |
| `ConditionalLogger`  | Logger with optional methods                                        |
| `SpanData`           | Span timing and attributes                                          |
| `LogEvent`           | `{ kind: "log", time, namespace, level, message, props? }`          |
| `SpanEvent`          | `{ kind: "span", time, namespace, duration, spanId, traceId, ... }` |
| `Event`              | `LogEvent \| SpanEvent`                                             |
| `Stage`              | `(event: Event) => Event \| null \| void`                           |
| `Pipeline`           | `{ dispatch, level, dispose }`                                      |
| `LogLevel`           | `"trace" \| "debug" \| ... \| "silent"`                             |
| `LogFormat`          | `"console" \| "json"`                                               |
| `LazyMessage`        | `string \| (() => string)`                                          |
| `LoggerFactory`      | `(name: string, config?) => ConditionalLogger`                      |
| `LoggerPlugin`       | `(factory: LoggerFactory, ctx: PluginCtx) => LoggerFactory`         |
| `PluginCtx`          | Shared context for inter-plugin communication                       |
| `ConfigElement`      | Union of all valid config array elements                            |
| `ConfigObject`       | Scope config: `{ level?, ns?, format?, spans? }`                    |
| `FileDescriptor`     | File output: `{ file, level?, ns?, format? }`                       |
| `Writable`           | Any object with `{ write, objectMode? }`                            |
| `FileWriter`         | `{ write, flush, close }`                                           |
| `IdFormat`           | `"simple" \| "w3c"`                                                 |
| `TraceparentOptions` | `{ sampled?: boolean }`                                             |

### Deprecated API

These functions still work but are deprecated. They map to environment variables internally:

| Export (deprecated)                                      | Replacement                                      |
| -------------------------------------------------------- | ------------------------------------------------ |
| `.logger(ns?, props?)`                                   | `.child(ns?, props?)`                            |
| `setLogLevel(level)` / `getLogLevel()`                   | `{ level }` in config array or `LOG_LEVEL` env   |
| `setLogFormat(format)` / `getLogFormat()`                | `{ format }` in config array or `LOG_FORMAT` env |
| `enableSpans()` / `disableSpans()` / `spansAreEnabled()` | `TRACE=1` env var                                |
| `setTraceFilter(ns)` / `getTraceFilter()`                | `TRACE=namespace` env var                        |
| `setDebugFilter(ns)` / `getDebugFilter()`                | `{ ns }` in config array or `DEBUG` env          |
| `addWriter(fn)`                                          | Stage functions or `{ file }` in config array    |
| `setOutputMode(mode)` / `getOutputMode()`                | Omit `console` from config array                 |
| `setSuppressConsole(bool)`                               | Omit `console` from config array                 |

## Exports from `loggily/context`

| Export                                                       | Description                            |
| ------------------------------------------------------------ | -------------------------------------- |
| `enableContextPropagation()` / `disableContextPropagation()` | AsyncLocalStorage context control      |
| `isContextPropagationEnabled()`                              | Check if context propagation is active |
| `getCurrentSpan()`                                           | Get current span context               |
| `runInSpanContext(ctx, fn)`                                  | Run function in specific context       |

## Exports from `loggily/otel`

OpenTelemetry bridge — forwards loggily events to OTLP-compatible backends. Requires `@opentelemetry/api` as a peer dependency.

| Export              | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `toOtel(options?)`  | Stage that forwards events to OpenTelemetry (transparent — events pass through) |
| `OtelBridgeOptions` | Options: `api`, `loggerName`, `tracerName`, `logs`, `spans`                     |

```typescript
import * as otelApi from "@opentelemetry/api"
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"

const log = createLogger("myapp", [toOtel({ api: otelApi }), console])
```

The stage is transparent — events pass through unchanged to subsequent pipeline elements (like `console` above). Set `logs: false` or `spans: false` to forward only one event type.

## Exports from `loggily/metrics`

Span metrics collection via explicit collectors.

| Export                     | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `withMetrics(collector)`   | Wrap a logger to record spans to a collector     |
| `createMetricsCollector()` | Create a standalone metrics collector            |
| `SpanStats`                | Stats type: count, min, max, mean, p50, p95, p99 |

## Exports from `loggily/worker`

| Export                                        | Description                                  |
| --------------------------------------------- | -------------------------------------------- |
| `createWorkerLogger(postMessage, ns, props?)` | Logger for worker threads                    |
| `workerTransportStage(postMessage)`           | Pipeline stage that forwards via postMessage |
| `handleWorkerEvents(logger)`                  | Route worker events to a logger              |
| `createWorkerLogHandler()`                    | Zero-config main thread handler              |
| `createWorkerConsoleHandler(opts?)`           | Console message handler                      |
| `forwardConsole(postMessage, ns?)`            | Forward console.\* from worker               |
| `restoreConsole()`                            | Restore original console methods             |
| `isWorkerMessage(msg)`                        | Type guard for any worker message            |
| `isWorkerConsoleMessage(msg)`                 | Type guard for console messages              |
| `isWorkerEvent(msg)`                          | Type guard for log/span events               |
| `isWorkerLogEvent(msg)`                       | Type guard for log events                    |
| `isWorkerSpanEvent(msg)`                      | Type guard for span events                   |
