# Worker Thread API

Import from `loggily/worker`.

## Worker Side

### createWorkerLogger

```typescript
function createWorkerLogger(
  postMessage: (msg: WorkerMessage) => void,
  namespace: string,
  props?: Record<string, unknown>,
  options?: { parentSpanId?: string; traceId?: string },
): Logger
```

Create a logger that forwards all output to the main thread via `postMessage`.

```typescript
const log = createWorkerLogger(postMessage, "myapp:worker")
log.info?.("processing", { file: "data.csv" })

{
  using span = log.span("parse")
  span.spanData.lines = 100
}
```

### forwardConsole

```typescript
function forwardConsole(postMessage: (msg: WorkerConsoleMessage) => void, namespace?: string): void
```

Monkey-patch `console.*` to forward output via `postMessage`.

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
function createWorkerLogHandler(): (message: WorkerMessage) => void
```

Handle all worker messages (logs, spans, console). Creates loggers per namespace automatically. Span output is controlled by the `TRACE` environment variable.

```typescript
const handle = createWorkerLogHandler()
worker.onmessage = (e) => handle(e.data)
```

### createWorkerConsoleHandler

```typescript
function createWorkerConsoleHandler(options?: {
  defaultNamespace?: string
  logger?: Logger
}): (message: WorkerConsoleMessage) => void
```

Handle only console forwarding messages.

## Type Guards

```typescript
isWorkerMessage(msg: unknown): msg is WorkerMessage
isWorkerConsoleMessage(msg: unknown): msg is WorkerConsoleMessage
isWorkerLogMessage(msg: unknown): msg is WorkerLogMessage
isWorkerSpanMessage(msg: unknown): msg is WorkerSpanMessage
```

## Message Types

```typescript
interface WorkerConsoleMessage {
  type: "console"
  level: "log" | "debug" | "info" | "warn" | "error" | "trace"
  namespace?: string
  args: unknown[]
  timestamp: number
}

interface WorkerLogMessage {
  type: "log"
  level: "trace" | "debug" | "info" | "warn" | "error"
  namespace: string
  message: string
  data?: Record<string, unknown>
  timestamp: number
}

interface WorkerSpanMessage {
  type: "span"
  event: "start" | "end"
  namespace: string
  spanId: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime?: number
  duration?: number
  props: Record<string, unknown>
  spanData: Record<string, unknown>
  timestamp: number
}
```
