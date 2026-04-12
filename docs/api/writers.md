# Output

## v2 Config Array (recommended)

In v2, output destinations are configured in the config array passed to `createLogger`:

```typescript
import { createLogger } from "loggily"

// Console + file output
const log = createLogger("myapp", [console, { file: "/tmp/app.log", format: "json" }])

// Errors-only file + console for everything
const log = createLogger("myapp", [console, { file: "/tmp/errors.log", level: "error", format: "json" }])

// Custom writable stream
const log = createLogger("myapp", [{ write: (s: string) => process.stderr.write(s + "\n") }])
```

### File Sink Options

When using `{ file: "/path" }` in the config array, you can override scope settings:

| Key      | Type                   | Description                   |
| -------- | ---------------------- | ----------------------------- |
| `file`   | `string`               | Output file path (required)   |
| `level`  | `LogLevel` (optional)  | Override level for this sink  |
| `ns`     | `string` (optional)    | Override namespace filter     |
| `format` | `LogFormat` (optional) | Override format for this sink |

### Writable Object Mode

Writables can receive raw `Event` objects instead of formatted strings by setting `objectMode: true`:

```typescript
const transport = {
  write: (event) => sendToService(event),
  objectMode: true,
}
const log = createLogger("myapp", [transport])
```

When `objectMode` is `false` (the default), the writable receives a formatted string (console or JSON, depending on the current scope's `format` setting) followed by a newline. When `objectMode` is `true`, the raw `Event` object is passed directly — useful for Pino transports, custom analytics pipelines, or any sink that needs structured data.

```typescript
interface Writable {
  write: (data: unknown) => unknown
  objectMode?: boolean
}
```

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

### Safety

- The flush interval timer is `unref()`'d so it won't keep the process alive
- A `process.on("exit")` handler flushes remaining buffer on shutdown
- `close()` removes the exit handler and clears the interval
- Multiple `close()` calls are safe (idempotent)
- `write()` after `close()` is silently ignored

## Deprecated v1 Writer API

```typescript
// Deprecated — use { file } in config array or custom stage functions instead
import { addWriter } from "loggily"

const unsub = addWriter((formatted: string, level: string) => {
  // receives formatted output
})
unsub() // unsubscribe
```

The `addWriter` function still works but is deprecated. Use `{ file }` in the config array for file output, or custom stage functions for custom routing.
