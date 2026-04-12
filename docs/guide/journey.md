# The Guide

> Clarity without the clutter. Debugs, logs, and spans -- one API.

Your first app uses `console.log`. That's enough for a script, a prototype, a small server. Then your app grows. You need structured logs for production, the `debug` package for conditional verbose output, a tracing library for timings, maybe OpenTelemetry for distributed traces -- and suddenly you're juggling three tools with three APIs, three configuration schemes, and three output formats.

Loggily is one library where structured logging, debug-style conditional output, and timed spans all share the same namespace tree, the same output pipeline, and the same `?.` pattern for near-zero cost disabled logging. You adopt each capability when you need it. Nothing is wasted, nothing conflicts, nothing clutters your code.

## Level 1: Just Log

You need structured logging with levels. One import, one function.

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp")

log.info?.("server started", { port: 3000 })
log.warn?.("disk space low", { free: "2GB" })
log.error?.(new Error("connection failed"))
```

Notice the `?.` -- if a log level is disabled, the entire call is skipped, including argument evaluation. For trivial arguments the overhead difference is negligible, but for real-world logging with string interpolation and serialization, this is typically **10x+ faster** because it skips the work entirely.

Colorized in your terminal, with source locations:

```
14:32:15 INFO myapp server started {port: 3000}
14:32:15 WARN myapp disk space low {free: "2GB"}
14:32:15 ERROR myapp connection failed
  Error: connection failed
    at server.ts:42
```

Set `LOG_FORMAT=json` or `NODE_ENV=production` and the same calls produce structured JSON -- same data, machine-parseable, ready for Datadog or Elastic or whatever your ops team uses:

```json
{ "time": "2024-01-15T14:32:15.123Z", "level": "info", "name": "myapp", "msg": "server started", "port": 3000 }
```

You never choose between human-readable and machine-parseable. You get both from the same call.

**The wall**: Your app has 20 modules. You need verbose output from the database layer but not from the HTTP layer. `LOG_LEVEL=debug` turns on everything.

## Level 2: Namespaces

Loggers form a tree. Child loggers inherit their parent's namespace and props:

```typescript
const log = createLogger("myapp")
const db = log.child("db") // myapp:db
const http = log.child("http") // myapp:http
const query = db.child("query") // myapp:db:query

db.debug?.("connecting") // myapp:db
query.debug?.("SELECT * FROM...") // myapp:db:query
```

Now you can target output. `DEBUG` auto-lowers the log level to `debug` and restricts all output to matching namespaces:

```bash
DEBUG=myapp:db bun run app                # Only myapp:db namespace (all levels)
DEBUG='myapp:*,-myapp:http' bun run app   # Everything except HTTP
LOG_LEVEL=debug bun run app               # Debug level globally, all namespaces
```

`DEBUG` is a namespace visibility filter compatible with the same patterns as the `debug` package -- same muscle memory -- but as part of a full logging system with levels, structured data, and JSON output. Use `LOG_LEVEL` when you want to change the verbosity floor without restricting namespaces.

You can also set namespace filters in the config array:

```typescript
const log = createLogger("myapp", [{ ns: "myapp:db,-myapp:db:verbose" }, console])
```

**The wall**: A request takes 3 seconds. You know it's slow, but you don't know which part.

## Level 3: Spans

A span is a logger with a timer. It measures how long a block takes, and every log inside it inherits its context:

```typescript
{
  using span = log.span("import", { file: "data.csv" })
  span.info?.("parsing rows")
  span.spanData.count = 42
}
// -> SPAN myapp:import (1234ms) {count: 42, file: "data.csv"}
```

The `using` keyword (TC39 Explicit Resource Management) automatically calls `span[Symbol.dispose]()` at block exit. The span measures its duration and reports it along with any attributes you set. No try/finally, no manual timing, no separate tracing SDK.

Spans nest. Each span gets a unique ID and shares its parent's trace ID, so you can correlate events across a request:

```typescript
{
  using req = log.span("request", { path: "/api/users" })
  {
    using db = req.span("db-query")
    // db.spanData.traceId === req.spanData.traceId
    // db.spanData.parentId === req.spanData.id
  }
}
```

Control span output independently from logs:

```bash
TRACE=1 bun run app                  # All spans
TRACE=myapp:db bun run app           # Only database spans
TRACE=myapp:db,myapp:cache bun run app  # Database + cache spans
```

**The wall**: Now you need logs sent elsewhere -- a file, Datadog, your tracing backend -- not just the console.

## Level 4: Output Pipeline

The config array defines where output goes as part of logger creation:

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [
  { level: "debug" },
  console,
  { file: "/var/log/app.log", format: "json" },
  { file: "/var/log/errors.log", level: "error", format: "json" },
])
```

Custom stage functions in the config array can transform, filter, or route events:

```typescript
const log = createLogger("myapp", [
  // Enrich events with hostname
  (event) => ({
    ...event,
    props: { ...event.props, host: hostname() },
  }),
  // Filter out sensitive data
  (event) => {
    if (event.kind === "log" && event.message.includes("password")) return null
    return event
  },
  console,
  { file: "/tmp/app.log", format: "json" },
])
```

Branch arrays create sub-pipelines with their own scope:

```typescript
const log = createLogger("myapp", [
  console,
  // Only metrics go to the metrics file
  [{ ns: "myapp:metrics" }, { file: "/tmp/metrics.log", format: "json" }],
])
```

For power users, `buildPipeline()` is exported for direct pipeline construction.

**The wall**: You spawn worker threads for heavy processing, but their logs vanish from the main output.

## Level 5: Workers

Worker threads get their own loggers that forward to the main thread:

```typescript
// worker.ts
import { createWorkerLogger } from "loggily/worker"

const log = createWorkerLogger(postMessage, "myapp:worker")
log.info?.("processing chunk", { size: 1000 })

{
  using span = log.span("process")
  // ...
}
```

```typescript
// main.ts
import { createWorkerLogHandler } from "loggily/worker"

const handler = createWorkerLogHandler()
worker.on("message", (msg) => handler(msg))
```

Logs and spans from workers appear in the same output stream with the same formatting. No interleaving, no lost messages.

**The wall**: You need request context (request ID, user ID) to appear in every log across a request -- without threading a logger through every function call.

## Level 6: Context

### Child loggers (explicit passing)

The simplest approach: create a child logger at the request boundary, pass it to downstream functions.

```typescript
const reqLog = log.child({ requestId: "abc-123", userId: 42 })

reqLog.info?.("handling request")
// -> 14:32:15 INFO myapp handling request {requestId: "abc-123", userId: 42}

await handleAuth(reqLog)
await handleQuery(reqLog)
```

Every log from `reqLog` carries `requestId` and `userId`. In JSON mode, these become top-level fields -- perfect for filtering in your log aggregator.

### Automatic context propagation (no passing required)

When threading a logger through every function isn't practical, enable automatic context propagation. This uses Node's [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage) -- a built-in mechanism that carries data through `async`/`await` chains without passing it as function arguments. Logs and spans automatically inherit the current request's trace context:

```typescript
import { enableContextPropagation, getCurrentSpan } from "loggily/context"

enableContextPropagation()

{
  using span = log.span("request", { path: "/api/users" })

  // ANY logger, ANYWHERE in this async context, auto-inherits trace_id and span_id
  log.info?.("handling request")
  // -> includes trace_id and span_id in JSON output

  // Child spans from other loggers auto-parent to the current span
  const dbLog = createLogger("db")
  {
    using query = dbLog.span("query")
    // query.spanData.parentId === span.spanData.id — automatic!
  }
}
```

No need to pass `span` or `reqLog` down the call stack. The async context carries it.

## What You Have

Normally, you'd pull in one library for logs, another for debug prints, a tracing SDK for spans -- and struggle to tie them together. With Loggily, these aren't separate concerns. They're modes of the same tool.

At this point you've replaced that patchwork with a single library:

- **Structured logging** with levels, namespaces, colorized dev output, JSON production output, and source locations
- **Debug output** with `DEBUG=namespace:*` filtering -- compatible with the debug package's patterns, integrated
- **Span timing** with `using` keyword, nested traces, and independent `TRACE=` control
- **Composable output** via the config array -- console, file, custom stages, branches
- **Worker thread support** with automatic forwarding
- **Context propagation** via child loggers or automatic `AsyncLocalStorage`

All sharing one namespace tree. All respecting the same log levels. All using the same `?.` pattern -- disabled calls are skipped entirely, including argument evaluation. There when you need it, invisible when you don't.

~3KB. Zero dependencies. Modern TypeScript.
