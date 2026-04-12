# Migrating from v1 to v2

Loggily v2 replaces global setters with composable config arrays. The core concept: **objects configure, arrays branch, values write**.

## Quick comparison

```ts
// v1: global setters
import { createLogger, setLogLevel, setDebugFilter, setLogFormat, enableSpans, addWriter } from "loggily"

setLogLevel("debug")
setDebugFilter(["myapp"])
setLogFormat("json")
enableSpans()
const removeWriter = addWriter((text, level) => sendToService(text))

const log = createLogger("myapp")
```

```ts
// v2: config array
import { createLogger } from "loggily"

const log = createLogger("myapp", [
  { level: "debug", ns: "myapp", format: "json" },
  console,
  (event) => {
    sendToService(formatJSONEvent(event))
    return event
  },
])
```

## Migration table

| v1 (global setter)          | v2 (config array)                          |
| --------------------------- | ------------------------------------------ |
| `setLogLevel("debug")`      | `{ level: "debug" }` in config array       |
| `setDebugFilter(["myapp"])` | `{ ns: "myapp" }` in config array          |
| `setLogFormat("json")`      | `{ format: "json" }` in config array       |
| `enableSpans()`             | `TRACE=1` env var (unchanged)              |
| `addWriter(fn)`             | Stage function or writable in config array |
| `createFileWriter(path)`    | `{ file: path }` in config array           |
| `setSuppressConsole(true)`  | Omit `console` from config array           |
| `setOutputMode("stderr")`   | Pass `process.stderr` in config array      |
| `.logger("auth")`           | `.child("auth")`                           |

## Step-by-step migration

### 1. Replace global setters with a config array

**Before:**

```ts
import { createLogger, setLogLevel, setDebugFilter, setLogFormat } from "loggily"

setLogLevel("debug")
setDebugFilter(["myapp", "-myapp:sql"])
setLogFormat("json")

export const log = createLogger("myapp")
```

**After:**

```ts
import { createLogger } from "loggily"

export const log = createLogger("myapp", [{ level: "debug", ns: "myapp,-myapp:sql", format: "json" }, console])
```

### 2. Replace file writers

**Before:**

```ts
import { createLogger, createFileWriter, addWriter } from "loggily"

const writer = createFileWriter("/tmp/app.log")
addWriter(writer.write)

export const log = createLogger("myapp")
```

**After:**

```ts
import { createLogger } from "loggily"

export const log = createLogger("myapp", [console, { file: "/tmp/app.log", format: "json" }])
```

### 3. Replace custom writers with stages

**Before:**

```ts
addWriter((text, level) => {
  if (level === "error") sendToSentry(text)
})
```

**After:**

```ts
const log = createLogger("myapp", [
  console,
  [
    { level: "error" },
    (event) => {
      sendToSentry(formatJSONEvent(event))
      return event
    },
  ],
])
```

### 4. Replace `.logger()` with `.child()`

**Before:**

```ts
const authLog = log.logger("auth", { sso: true })
```

**After:**

```ts
const authLog = log.child("auth", { sso: true })
```

`.logger()` still works but is deprecated.

### 5. Use env vars for runtime control

v2 reads the same environment variables as v1:

| Variable     | Effect                                             |
| ------------ | -------------------------------------------------- |
| `LOG_LEVEL`  | Minimum output level (default: `info`)             |
| `DEBUG`      | Namespace filter (same syntax as `debug` package)  |
| `LOG_FORMAT` | `console` or `json`                                |
| `TRACE`      | `1`, `true`, or namespace prefixes for span output |

When no config array is passed, `createLogger` reads these automatically:

```ts
const log = createLogger("myapp") // reads LOG_LEVEL, DEBUG, etc.
```

### 6. Use branches for multi-destination logging

v2 config arrays support branching with nested arrays:

```ts
const log = createLogger("myapp", [
  { level: "debug" },
  console, // everything to console
  [{ level: "error" }, { file: "/tmp/errors.log" }], // errors to file
  [{ ns: "myapp:metrics" }, { file: "/tmp/metrics.log", format: "json" }],
])
```

## Backwards compatibility

v1 global setters still work but are deprecated. They map to environment variables internally:

- `setLogLevel("debug")` sets `process.env.LOG_LEVEL = "debug"`
- `enableSpans()` sets `process.env.TRACE = "1"`
- `setDebugFilter(["ns"])` sets `process.env.DEBUG = "ns"`

This means v1 setters affect loggers created **without** explicit config arrays. Loggers with explicit config arrays are self-contained.

## Common patterns

### Shared logger module

```ts
// app/logger.ts
import { createLogger } from "loggily"

export const log = createLogger("myapp", [
  { level: "debug", ns: "-myapp:sql" },
  console,
  { file: "/var/log/myapp.log", level: "info", format: "json" },
])

// app/auth.ts
import { log } from "./logger.ts"
const authLog = log.child("auth")
authLog.info?.("login attempted", { user: "alice" })
```

### Test logger

```ts
import { createTestLogger } from "loggily"
const log = createTestLogger("test") // all levels enabled, console output
```

### Plugin composition

```ts
import { createLogger, pipe, withEnvDefaults } from "loggily"

const myCreateLogger = pipe(createLogger, withSentry({ dsn: "..." }))
const log = myCreateLogger("myapp")
```
