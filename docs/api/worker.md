# Worker Thread API

Import from `loggily/worker`.

Worker loggers use the same pipeline as main-thread loggers. Events are plain JSON objects forwarded via `postMessage` — no custom protocol, no serialization layer. `structuredClone` (used by `postMessage`) handles serialization natively.

## Worker Side

### createWorkerLogger

```typescript
function createWorkerLogger(
  postMessage: (msg: unknown) => void,
  namespace: string,
  props?: Record<string, unknown>,
): ConditionalLogger
```

Create a logger that forwards all events to the main thread via `postMessage`. Uses a real logger with a transport stage — child loggers, spans, error serialization, and trace IDs all work identically to main-thread loggers.

```typescript
import { createWorkerLogger } from "loggily/worker"

const log = createWorkerLogger(postMessage, "myapp:worker")
log.info?.("processing", { file: "data.csv" })

{
  using span = log.span?.("parse")
  span?.info?.("parsing...")
  if (span) span.spanData.lines = 100
}
```

### workerTransportStage

```typescript
function workerTransportStage(postMessage: (msg: unknown) => void): Stage
```

A pipeline Stage that forwards events via `postMessage` and consumes them (returns `null`). For custom worker logger composition:

```typescript
import { pipe, baseCreateLogger, withSpans } from "loggily"
import { workerTransportStage } from "loggily/worker"

const createLogger = pipe(baseCreateLogger, withSpans())
const log = createLogger("worker", [workerTransportStage(postMessage)])
```

### forwardConsole

```typescript
function forwardConsole(
  postMessage: (msg: unknown) => void,
  namespace?: string,
): void
```

Monkey-patch `console.*` to forward output via `postMessage`. Functions and Symbols are stringified before posting; Errors are serialized to `{ name, message, stack }`. Other values are passed directly — `postMessage` uses `structuredClone`, so most types work natively.

```typescript
forwardConsole(postMessage, "myapp:worker")
console.log("this is forwarded")
```

### restoreConsole

```typescript
function restoreConsole(): void
```

Restore original `console.*` methods.

## Main Thread Side

### createWorkerLogHandler

```typescript
function createWorkerLogHandler(): (message: unknown) => void
```

Zero-config handler — creates loggers per namespace automatically. Handles both `Event` objects (log/span) and `WorkerConsoleMessage` objects (console forwarding).

```typescript
const handle = createWorkerLogHandler()
worker.on("message", (msg) => handle(msg))
```

### handleWorkerEvents

```typescript
function handleWorkerEvents(
  target: ConditionalLogger | { dispatch(event: Event): void },
): (msg: unknown) => void
```

Route worker events to a specific logger. More control than `createWorkerLogHandler`:

```typescript
import { createLogger } from "loggily"
import { handleWorkerEvents } from "loggily/worker"

const workerLog = createLogger("worker", [console, { file: "/tmp/worker.log" }])
worker.on("message", handleWorkerEvents(workerLog))
```

### createWorkerConsoleHandler

```typescript
function createWorkerConsoleHandler(options?: {
  defaultNamespace?: string
  logger?: ConditionalLogger
}): (message: WorkerConsoleMessage) => void
```

Handle only console forwarding messages (from `forwardConsole`).

## Type Guards

```typescript
isWorkerEvent(msg: unknown):
  msg is Event              // LogEvent | SpanEvent
isWorkerLogEvent(msg: unknown):
  msg is LogEvent           // kind === "log"
isWorkerSpanEvent(msg: unknown):
  msg is SpanEvent          // kind === "span"
isWorkerConsoleMessage(msg: unknown):
  msg is WorkerConsoleMessage // type === "console"
isWorkerMessage(msg: unknown):
  msg is WorkerConsoleMessage | Event // any worker msg
```

## Message Format

Worker log/span messages are standard `Event` objects (same as main-thread events):

```typescript
// LogEvent (kind: "log")
{
  kind: "log", time: 1234567890,
  namespace: "worker", level: "info",
  message: "hello", props: { file: "x" }
}

// SpanEvent (kind: "span")
{
  kind: "span", time: 1234567890,
  namespace: "worker:parse", name: "parse",
  duration: 42, spanId: "sp_1",
  traceId: "tr_1", parentId: null
}
```

Console messages use a separate format:

```typescript
interface WorkerConsoleMessage {
  type: "console"
  level: "log" | "debug" | "info" | "warn" | "error" | "trace"
  namespace?: string
  args: unknown[]
  timestamp: number
}
```

## structuredClone Limitations

`postMessage` uses `structuredClone` for serialization. Most values work natively, but some don't:

- **Functions** — not cloneable (forwardConsole stringifies them: `[Function: name]`)
- **Symbols** — not cloneable (forwardConsole converts: `Symbol(test)`)
- **DOM nodes** — not cloneable (worker threads don't have DOM)
- **WeakMap/WeakSet** — not cloneable

For structured logging via `createWorkerLogger`, this is rarely an issue — log props are typically plain objects, strings, and numbers. The transport stage has a JSON fallback for edge cases.
