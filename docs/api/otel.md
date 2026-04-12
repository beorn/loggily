# OpenTelemetry Bridge

Import from `loggily/otel`. Works everywhere. Requires `@opentelemetry/api` as a peer dependency.

Forwards loggily events to any OTLP-compatible backend (Jaeger, Grafana, Datadog, etc.). The stage is transparent — events pass through unchanged to subsequent pipeline elements.

## Quick Start

```typescript
import * as otelApi from "@opentelemetry/api"
import { createLogger } from "loggily"
import { toOtel } from "loggily/otel"

const log = createLogger("myapp", [toOtel({ api: otelApi }), console])

log.info?.("request handled", { status: 200 })
// → forwarded to OTLP backend AND printed to console
```

## API

| Export | Description |
| --- | --- |
| `toOtel(options?)` | Pipeline stage that forwards events to OpenTelemetry |
| `OtelBridgeOptions` | Options type |

### Options

```typescript
interface OtelBridgeOptions {
  api: typeof import("@opentelemetry/api")  // required
  loggerName?: string   // OTLP logger name (default: "loggily")
  tracerName?: string   // OTLP tracer name (default: "loggily")
  logs?: boolean        // forward log events (default: true)
  spans?: boolean       // forward span events (default: true)
}
```

## How it works

`toOtel()` is a regular pipeline stage — it receives events, forwards them to OpenTelemetry, and passes them through unchanged. This means you can place it anywhere in your pipeline:

```typescript
const log = createLogger("myapp", [
  { level: "info" },
  toOtel({ api: otelApi }),           // forward to OTLP
  console,                            // also print to console
  { file: "/tmp/app.log" },           // also write to file
])
```

Set `logs: false` or `spans: false` to forward only one event type:

```typescript
// Only forward spans to OTLP, handle logs locally
toOtel({ api: otelApi, logs: false })
```

## When to use this vs raw OpenTelemetry

Use this bridge when you want loggily's API (conditional `?.`, config pipeline, namespace hierarchy) but need to export to an OTLP backend. For full auto-instrumentation (HTTP, database, gRPC), use OpenTelemetry's SDK directly.
