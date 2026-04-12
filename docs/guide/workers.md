# Worker Thread Support

Loggily provides typed message protocols for forwarding logs from worker threads to the main thread.

## Full Logger Forwarding

### Worker Side

```typescript
import { createWorkerLogger } from "loggily/worker"

const log = createWorkerLogger(postMessage, "myapp:worker")

log.info?.("processing", { file: "data.csv" })

{
  using span = log.span("parse")
  span.info?.("parsing rows")
  span.spanData.lines = 100
}
// Span events forwarded to main thread automatically
```

### Main Thread Side

```typescript
import { createWorkerLogHandler, isWorkerMessage } from "loggily/worker"

const handle = createWorkerLogHandler()

worker.onmessage = (e) => {
  if (isWorkerMessage(e.data)) {
    handle(e.data)
  } else {
    // Handle other message types
  }
}
```

## Console Forwarding

For simpler cases, forward `console.*` calls:

### Worker Side

```typescript
import { forwardConsole } from "loggily/worker"

forwardConsole(postMessage, "myapp:worker")

// All console.* calls are now forwarded
console.log("processing", { file: "data.csv" })
console.error(new Error("failed"))
```

### Main Thread Side

```typescript
import { createWorkerConsoleHandler } from "loggily/worker"

const handle = createWorkerConsoleHandler({
  defaultNamespace: "myapp:worker",
})

worker.onmessage = (e) => {
  if (e.data.type === "console") {
    handle(e.data)
  }
}
```

## Message Types

Worker log/span events are standard `Event` objects (same as main-thread events). Console messages use a separate `WorkerConsoleMessage` type. Use type guards to handle them:

```typescript
import {
  isWorkerConsoleMessage,
  isWorkerEvent,
  isWorkerLogEvent,
  isWorkerSpanEvent,
  isWorkerMessage,
} from "loggily/worker"
```

| Type Guard               | Message Type               |
| ------------------------ | -------------------------- |
| `isWorkerConsoleMessage` | `console.*` forwarding     |
| `isWorkerLogEvent`       | Log events (kind: "log")   |
| `isWorkerSpanEvent`      | Span events (kind: "span") |
| `isWorkerEvent`          | Any log or span event      |
| `isWorkerMessage`        | Any of the above           |

## Serialization

`postMessage` uses `structuredClone`, which handles most values natively. For console forwarding, non-cloneable values are pre-sanitized:

- Functions become `"[Function: name]"`
- Symbols become their `toString()` representation
- Errors become `{ name, message, stack }`
- Circular references become `"[Circular]"`
- Errors become `{ name, message, stack }` objects
- Depth is capped at 5 levels

## Restoring Console

If you need to disable console forwarding:

```typescript
import { restoreConsole } from "loggily/worker"

// Later:
restoreConsole() // Original console methods restored
```
