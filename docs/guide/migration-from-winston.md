# Migration from Winston

Step-by-step guide for migrating from Winston to Loggily.

## Why Migrate?

| Feature                   | Winston                 | Loggily                       |
| ------------------------- | ----------------------- | ----------------------------- |
| Log levels                | Customizable            | 5 fixed levels + silent       |
| Structured data           | Yes (metadata)          | Yes (data parameter)          |
| Disabled call overhead    | ~372ns                  | **~2.5ns** (?. pattern)       |
| Disabled + expensive args | ~741ns (args evaluated) | **~3.6ns (args skipped)**     |
| Built-in spans/tracing    | No                      | Yes (with `using` keyword)    |
| Transports                | Rich ecosystem          | Config array + file output    |
| Pretty print              | Via formats             | Built-in                      |
| Bundle size               | ~60KB + transports      | ~3KB                          |
| Browser support           | Via browser transport   | Built-in (conditional export) |
| Config model              | Options object          | Composable config array       |

## Quick Migration

### Before (Winston)

```typescript
import winston from "winston"

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
})

logger.info("server started", { port: 3000 })
logger.error("request failed", { error: err.message })
```

### After (Loggily)

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "info" }, console])

log.info?.("server started", { port: 3000 })
log.error?.(err) // Automatic Error handling
```

## Pattern Mapping

### Logger Creation

```typescript
// Winston
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
})

// Loggily
const log = createLogger("myapp", [{ level: "info" }, console])
// Or use env vars: LOG_LEVEL=info, LOG_FORMAT=json, NODE_ENV=production
const log = createLogger("myapp")
```

### Log Calls

```typescript
// Winston — message first, metadata spread or second arg
logger.info("starting", { port: 3000 })
logger.info({ message: "starting", port: 3000 })
logger.error("failed", { error: err.message, stack: err.stack })

// Loggily — message + optional data
log.info?.("starting", { port: 3000 })
log.error?.(err) // Error: auto-extracts message, stack, code
log.error?.(err, "startup failed", { context: "init" }) // With custom message
```

### Levels

| Winston Level | Loggily Level           |
| ------------- | ----------------------- |
| error         | error                   |
| warn          | warn                    |
| info          | info                    |
| http          | info (no separate http) |
| verbose       | debug                   |
| debug         | debug                   |
| silly         | trace                   |

### Child Loggers

```typescript
// Winston — child loggers via defaultMeta
const childLogger = logger.child({ requestId: "abc" })
childLogger.info("processing")

// Loggily — .child() handles both patterns
const child = log.child({ requestId: "abc" }) // Context fields
const dbLog = log.child("db") // Namespace: myapp:db
const dbLog = log.child("db", { pool: "main" }) // Both
```

`.child()` always returns `ConditionalLogger`.

### Transports / Output

```typescript
// Winston transports
const logger = winston.createLogger({
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: "app.log" })],
})

// Loggily v2 — config array
const log = createLogger("myapp", [console, { file: "/tmp/app.log", format: "json" }])
```

### Custom Output

```typescript
// Winston — custom transport
class AlertTransport extends winston.Transport {
  log(info, callback) {
    if (info.level === "error") sendToAlertService(info)
    callback()
  }
}

// Loggily v2 — stage function in config array
const log = createLogger("myapp", [
  (event) => {
    if (event.kind === "log" && event.level === "error") {
      sendToAlertService(event)
    }
    return event // pass through to next stage
  },
  console,
])
```

### Formats

```typescript
// Winston — format combinators
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`),
  ),
})

// Loggily — built-in formats, configured via config array or env
const log = createLogger("myapp", [{ format: "json" }, console]) // JSON
const log = createLogger("myapp", [console]) // Console (default)
// Or: NODE_ENV=production auto-enables JSON
```

### Timing

```typescript
// Winston (manual profiling)
logger.profile("operation")
await doWork()
logger.profile("operation") // logs duration

// Loggily (built-in spans)
{
  using span = log.span("operation")
  await doWork()
}
// Automatic: SPAN myapp:operation (234ms)
```

## Environment Variables

| Winston                  | Loggily               | Effect             |
| ------------------------ | --------------------- | ------------------ |
| N/A (configured in code) | `LOG_LEVEL=debug`     | Set minimum level  |
| N/A                      | `DEBUG=myapp`         | Namespace filter   |
| N/A                      | `TRACE=1`             | Enable span output |
| N/A                      | `LOG_FORMAT=json`     | Force JSON output  |
| `NODE_ENV=production`    | `NODE_ENV=production` | Auto-enable JSON   |

## Migration Checklist

1. **Update dependencies**: `bun remove winston` and `bun add loggily`
2. **Update imports**: `import winston from "winston"` to `import { createLogger } from "loggily"`
3. **Replace `createLogger()`**: Winston's options to `createLogger("name", [config])` or `createLogger("name")` + env vars
4. **Convert transports** to `{ file }` in config array or custom stage functions
5. **Remove format configuration** -- built-in formats handle dev/prod automatically
6. **Add `?.`** to all log calls for near-zero cost disabled logging
7. **Map custom levels**: http to info, verbose to debug, silly to trace
8. **Convert `logger.profile()`** to spans with `using`
9. **Replace `logger.child()`** with `.child()` -- use `.child({ ... })` for context, `.child("name")` for namespace, or `.child("name", { ... })` for both
