# Migration from Pino

Step-by-step guide for migrating from Pino to Loggily.

## Why Migrate?

| Feature                   | Pino                   | Loggily                        |
| ------------------------- | ---------------------- | ------------------------------ |
| Log levels                | Yes (7 levels)         | Yes (5 levels + silent)        |
| Structured data           | Yes (JSON)             | Yes (JSON + pretty console)    |
| Disabled call overhead    | ~0.5ns (noop)          | ~2.5ns (?. proxy)              |
| Disabled + expensive args | 129ns (args evaluated) | **3.6ns (args skipped)**       |
| Built-in spans/tracing    | No                     | Yes (with `using` keyword)     |
| Child loggers             | Yes                    | Yes                            |
| Pretty print              | Via pino-pretty        | Built-in                       |
| Bundle size               | ~14KB + transports     | ~3KB                           |
| Browser support           | Via pino/browser       | Built-in (conditional export)  |
| Config model              | Options object         | Composable config array        |

## Quick Migration

### Before (Pino)

```typescript
import pino from "pino"

const logger = pino({ level: "info" })
const child = logger.child({ module: "db" })

logger.info({ port: 3000 }, "server started")
child.debug({ query: sql, params }, "executing query")
```

### After (Loggily)

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "info" }, console])
const dbLog = log.logger("db")

log.info?.("server started", { port: 3000 })
dbLog.debug?.("executing query", { query: sql, params })
```

## Pattern Mapping

### Logger Creation

```typescript
// Pino
const logger = pino()
const logger = pino({ level: "debug" })
const logger = pino({ name: "myapp" })

// Loggily
const log = createLogger("myapp")
const log = createLogger("myapp", [{ level: "debug" }, console])
```

### Log Calls

```typescript
// Pino — data object first, then message
logger.info({ userId: 42 }, "user logged in")
logger.info("simple message")
logger.error({ err }, "request failed")
logger.error(err, "request failed") // Error serialization

// Loggily — message first, then data
log.info?.("user logged in", { userId: 42 })
log.info?.("simple message")
log.error?.(err, "request failed") // Error + custom message
log.error?.(err) // Extracts message, stack, code
```

### Child Loggers

```typescript
// Pino
const child = logger.child({ requestId: "abc" })
child.info("handling request")

// Loggily — two patterns
// 1. Context fields (like Pino's child)
const child = log.child({ requestId: "abc" })
child.info?.("handling request") // includes requestId

// 2. Namespace (extends the logger name)
const dbLog = log.logger("db") // name: "myapp:db"
```

Both `.logger()` and `.child()` return `ConditionalLogger`.

### Levels

| Pino Level | Value | Loggily Level             |
| ---------- | ----: | ------------------------- |
| trace      |    10 | trace                     |
| debug      |    20 | debug                     |
| info       |    30 | info                      |
| warn       |    40 | warn                      |
| error      |    50 | error                     |
| fatal      |    60 | error (no separate fatal) |
| silent     |     - | silent                    |

### Transports / Output

```typescript
// Pino transports
const logger = pino({
  transport: {
    target: "pino/file",
    options: { destination: "/tmp/app.log" },
  },
})

// Loggily v2 — config array
const log = createLogger("myapp", [
  console,
  { file: "/tmp/app.log", format: "json" },
])
```

### Serializers

```typescript
// Pino serializers
const logger = pino({
  serializers: {
    req: pino.stdSerializers.req,
    err: pino.stdSerializers.err,
  },
})

// Loggily — handle in data parameter
log.info?.("request", {
  method: req.method,
  url: req.url,
  statusCode: res.statusCode,
})
log.error?.(err) // Built-in Error serialization
```

### Timing

```typescript
// Pino (manual)
const start = Date.now()
await operation()
logger.info({ duration: Date.now() - start }, "operation complete")

// Loggily (built-in spans)
{
  using span = log.span("operation")
  await operation()
  span.spanData.rowCount = 500
}
// Automatic: SPAN myapp:operation (234ms) {rowCount: 500}
```

## Environment Variables

| Pino                  | Loggily               | Effect                                |
| --------------------- | --------------------- | ------------------------------------- |
| `LOG_LEVEL=debug`     | `LOG_LEVEL=debug`     | Set minimum level                     |
| N/A                   | `DEBUG=myapp`         | Namespace filter (auto-enables debug) |
| N/A                   | `TRACE=1`             | Enable span output                    |
| N/A                   | `LOG_FORMAT=json`     | Force JSON output                     |
| `NODE_ENV=production` | `NODE_ENV=production` | Auto-enable JSON                      |

## Migration Checklist

1. **Update dependencies**: `bun remove pino pino-pretty && bun add loggily`
2. **Update imports**: `import pino from "pino"` to `import { createLogger } from "loggily"`
3. **Swap argument order**: Pino uses `(data, message)`, Loggily uses `(message, data)`
4. **Replace `logger.child()`** with `.child()` (context) or `.logger()` (namespace)
5. **Convert transports** to `{ file }` in the config array or custom stage functions
6. **Add `?.`** to all log calls for near-zero cost disabled logging
7. **Convert manual timing** to spans with `using`
8. **Replace `fatal`** with `error` (add a custom label in data if needed)
