# API Reference

## Exports from `loggily`

### Core

| Export                        | Description                 |
| ----------------------------- | --------------------------- |
| `createLogger(name, config?)` | Create a conditional logger |

### Config Array Elements

The second argument to `createLogger` is an optional config array:

| Element Type   | Example                                          | Description                         |
| -------------- | ------------------------------------------------ | ----------------------------------- |
| Config object  | `{ level: "debug", ns: "-sql", format: "json" }` | Set scope for subsequent elements   |
| `console`      | `console`                                        | Console output at current scope     |
| File sink      | `{ file: "/path", level?, ns?, format? }`        | File output with optional overrides |
| Stage function | `(event) => event \| null \| void`               | Transform, filter, or enrich events |
| Branch array   | `[{ ns: "metrics" }, { file: "/tmp/m.log" }]`    | Sub-pipeline with own scope         |
| Writable       | `{ write: (s: string) => void }`                 | Any writable stream                 |

### Pipeline (power users)

| Export                                   | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| `buildPipeline(elements, parentConfig?)` | Build a pipeline from config array elements |
| `defaultPipeline()`                      | Create the default env-var-based pipeline   |

### Testing

| Export                                          | Description                    |
| ----------------------------------------------- | ------------------------------ |
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
| `FileWriter`         | `{ write, flush, close }`                                           |
| `IdFormat`           | `"simple" \| "w3c"`                                                 |
| `TraceparentOptions` | `{ sampled?: boolean }`                                             |

### Deprecated v1 API

These functions still work but are deprecated. They map to environment variables internally:

| Export (deprecated)                                      | v2 Replacement                                   |
| -------------------------------------------------------- | ------------------------------------------------ |
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

## Exports from `loggily/worker`

| Export                                        | Description                       |
| --------------------------------------------- | --------------------------------- |
| `createWorkerLogger(postMessage, ns, props?)` | Logger for worker threads         |
| `createWorkerLogHandler(opts?)`               | Main thread handler               |
| `createWorkerConsoleHandler(opts?)`           | Console message handler           |
| `forwardConsole(postMessage, ns?)`            | Forward console.\* from worker    |
| `restoreConsole()`                            | Restore original console methods  |
| `isWorkerMessage(msg)`                        | Type guard for any worker message |
| `isWorkerConsoleMessage(msg)`                 | Type guard for console messages   |
| `isWorkerLogMessage(msg)`                     | Type guard for log messages       |
| `isWorkerSpanMessage(msg)`                    | Type guard for span messages      |
