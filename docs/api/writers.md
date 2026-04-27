# Writers

## Config Array

Output destinations are configured in the config array passed to `createLogger`:

```typescript
import { createLogger } from "loggily"

// Console + file output
const log = createLogger("myapp", [
  console,
  { file: "/tmp/app.log", format: "json" },
])

// Errors-only file + console for everything
const log = createLogger("myapp", [
  console,
  { file: "/tmp/errors.log", level: "error", format: "json" },
])

// Custom writable — receives raw Event objects
const log = createLogger("myapp", [
  { write: (event) => myService.ingest(event) },
])

// Pino transport — just pass it directly
const log = createLogger("myapp", [pinoTransport, console])
```

### Writable Sinks

Any object with a `write` method is a writable sink. By default, writables receive **raw `Event` objects** — structured data you can inspect, transform, or forward:

```typescript
const log = createLogger("myapp", [
  {
    write: (event) => {
      // event.kind === "log" or "span"
      // event.level, event.namespace, event.message, event.props
      analytics.track(event)
    },
  },
  console,
])
```

**Node.js streams** (`process.stderr`, `fs.createWriteStream()`) are auto-detected and receive **formatted strings** instead — no `objectMode` flag needed.

```typescript
// process.stderr auto-detected as a Node stream → receives strings
const log = createLogger("myapp", [process.stderr])
```

### objectMode (explicit override)

You can override the default with `objectMode`:

| objectMode  | Behavior                                                      | When to use                          |
| ----------- | ------------------------------------------------------------- | ------------------------------------ |
| _(omitted)_ | Auto: plain `{ write }` gets Events, Node streams get strings | Almost always                        |
| `true`      | Force raw Event objects                                       | Node stream that you want Events     |
| `false`     | Force formatted strings                                       | Plain `{ write }` that wants strings |

```typescript
// Force a plain writable to receive formatted strings
const log = createLogger("myapp", [
  { write: (s: string) => file.appendSync(s), objectMode: false },
])
```

```typescript
interface Writable {
  write: (data: unknown) => unknown
  // Set to false for formatted strings.
  // Default: true for plain objects,
  // false for Node streams.
  objectMode?: boolean
}
```

### Stage Functions

Stage functions are **transforms**, not sinks. They always receive and return raw `Event` objects:

```typescript
const log = createLogger("myapp", [
  // Filter: return null to drop
  (event) =>
    event.kind === "log" && event.message.includes("secret") ? null : event,
  // Enrich: add fields
  (event) => ({ ...event, props: { ...event.props, host: hostname() } }),
  console,
])
```

### File Sink Options

When using `{ file: "/path" }` in the config array, you can override scope settings:

| Key      | Type                   | Description                   |
| -------- | ---------------------- | ----------------------------- |
| `file`   | `string`               | Output file path (required)   |
| `level`  | `LogLevel` (optional)  | Override level for this sink  |
| `ns`     | `string` (optional)    | Override namespace filter     |
| `format` | `LogFormat` (optional) | Override format for this sink |

## createFileWriter (low-level)

For direct file writing outside the config array:

```typescript
import { createFileWriter } from "loggily"

function createFileWriter(path: string, options?: FileWriterOptions): FileWriter
```

Create a buffered file writer that flushes automatically.

### Options

| Option          | Type     | Default | Description                            |
| --------------- | -------- | ------- | -------------------------------------- |
| `bufferSize`    | `number` | 4096    | Flush when buffer exceeds this (bytes) |
| `flushInterval` | `number` | 100     | Flush every N milliseconds             |

### FileWriter Methods

| Method        | Description                           |
| ------------- | ------------------------------------- |
| `write(line)` | Append line to buffer (adds `\n`)     |
| `flush()`     | Write buffer to disk immediately      |
| `close()`     | Flush remaining buffer and close file |

## addWriter (low-level)

`addWriter` registers a function that receives **formatted output** alongside the structured `Event` so you can route, filter, or fan-out without hand-rolling a config array. Three forms:

```typescript
import { addWriter, createFileWriter } from "loggily"

// 1. Catch-all — every record reaches the writer
const unsub = addWriter((formatted, level, namespace, event) => {
  console.error(formatted)
})

// 2. Scoped — only records matching the config reach the writer.
//    The config object accepts the same `{ ns, level }` shape used in
//    createLogger config arrays, so the mental model is uniform.
const file = createFileWriter("/tmp/bg-recall.log")
addWriter(
  { ns: "bg-recall:*" },
  (formatted) => file.write(formatted),
)

// 3. Multi-dimensional filter
addWriter(
  { ns: "bg-recall:*", level: "warn" },
  (formatted, level, namespace, event) => {
    // Only bg-recall:* records at warn-or-above
  },
)

unsub() // call the returned handle to remove the writer
```

### Config keys

| Key     | Type                   | Description                                            |
| ------- | ---------------------- | ------------------------------------------------------ |
| `ns`    | `string \| string[]`   | DEBUG-style namespace pattern (supports `*` and `-ns`) |
| `level` | `LogLevel`             | Records below the level skip the writer                |

### When to use addWriter vs config array

- **Config array** (`createLogger("x", [console, { file }])`) — declarative, sets up sinks at logger creation time. Best for stable destinations.
- **`addWriter`** — imperative, runs at any time, returns an unsubscribe handle. Best for host-app startup wiring (`if (process.env.LOGGILY_FILE) addWriter({ ns: "app:*" }, fileWriter)`) or test instrumentation.

Both reach the same pipeline.
