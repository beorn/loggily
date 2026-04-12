# Logger

## createLogger

```typescript
function createLogger(name: string, config?: unknown[]): ConditionalLogger
```

Create a conditional logger. Disabled log levels return `undefined` -- use `?.` to skip argument evaluation when disabled.

The optional second argument is a config array: objects configure (`{ level, ns, format }`), arrays branch, values write.

```typescript
// Zero config (reads LOG_LEVEL, DEBUG, LOG_FORMAT from env)
const log = createLogger("myapp")

// With config array
const log = createLogger("myapp", [
  { level: "debug" },
  console,
  { file: "/tmp/app.log", level: "error", format: "json" },
])
```

## Logger Methods

### Logging

All accept `LazyMessage` (string or `() => string`) and optional data:

```typescript
log.trace?.("verbose", { detail: "..." })
log.debug?.("debugging", { state: "..." })
log.info?.("normal operation")
log.warn?.("recoverable issue")
log.error?.(new Error("failed"))
log.error?.(new Error("timeout"), "request failed", { url: "/api" })
log.error?.("manual error", { code: "ETIMEOUT" })
```

### Child Creation

`.child()` is the single method for creating child loggers:

```typescript
// Extend namespace
const db = log.child("db")
// namespace: "myapp:db"

// Add context to every message (same namespace)
const req = log.child({ requestId: "abc" })

// Both: extend namespace + add fields
const db = log.child("db", { pool: "primary" })
// namespace: "myapp:db", all logs include pool

// Create timed span
{
  using span = log.span("import")
  span.spanData.count = 42
}
```

`.child()` always returns `ConditionalLogger`.

::: info Deprecated
`.logger()` still works but is deprecated. Use `.child()` instead.
:::

### Manual Span End

```typescript
const span = log.span("op")
try {
  /* ... */
} finally {
  span.end()
}
```

## ConditionalLogger

The return type of `createLogger()` and `.child()`. Log methods are possibly `undefined`:

```typescript
interface ConditionalLogger {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  trace?: (msg: LazyMessage, data?: Record<string, unknown>) => void
  debug?: (msg: LazyMessage, data?: Record<string, unknown>) => void
  info?: (msg: LazyMessage, data?: Record<string, unknown>) => void
  warn?: (msg: LazyMessage, data?: Record<string, unknown>) => void
  error?: {
    (msg: LazyMessage, data?: Record<string, unknown>): void
    (error: Error, data?: Record<string, unknown>): void
    (error: Error, message: string, data?: Record<string, unknown>): void
  }
  /** @deprecated Use .child() */
  logger(ns?: string, props?: Record<string, unknown>): ConditionalLogger
  span(ns?: string, props?: LazyProps): SpanLogger
  child(namespace: string, props?: Record<string, unknown>): ConditionalLogger
  child(context: Record<string, unknown>): ConditionalLogger
  end(): void
}
```

## SpanLogger

Logger + timing + Disposable:

```typescript
interface SpanLogger extends Logger, Disposable {
  readonly spanData: SpanData & { [key: string]: unknown }
}
```

### SpanData

| Property    | Type             | Writable | Description                 |
| ----------- | ---------------- | -------- | --------------------------- |
| `id`        | `string`         | No       | `sp_1`, `sp_2`, ...         |
| `traceId`   | `string`         | No       | Shared across nested spans  |
| `parentId`  | `string \| null` | No       | Parent span ID              |
| `startTime` | `number`         | No       | Start timestamp             |
| `endTime`   | `number \| null` | No       | End timestamp               |
| `duration`  | `number`         | No       | Live computed duration      |
| `[custom]`  | `unknown`        | **Yes**  | `span.spanData.key = value` |
