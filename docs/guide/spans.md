# Spans

Spans are loggers with timing. Call `.span?.()` and it creates a child logger that tracks how long the block runs. When spans are disabled, `.span` is `undefined`, so optional chaining skips the call and its arguments.

## Basic Usage

```typescript
{
  using span = log.span?.("import", { file: "data.csv" })
  span?.info?.("parsing rows")
  const rows = await parseFile()
  if (span) span.spanData.rowCount = rows.length
}
// SPAN myapp:import (1234ms) {rowCount: 500, file: "data.csv"}
```

The `using` keyword (TC39 Explicit Resource Management) calls `span[Symbol.dispose]()` when the block exits, which records the end time and emits the span event.

## Enabling Spans

Span output is off by default. Enable via environment variables:

```bash
TRACE=1 bun run app              # All spans
TRACE=myapp:db bun run app       # Only db spans
TRACE=myapp,other bun run app    # Multiple namespaces
```

With spans disabled, `log.span` is `undefined`:

```typescript
using span = log.span?.("import", expensiveProps())
// expensiveProps() is not called unless TRACE enables this logger
```

Span availability is checked when the logger is created. Set `TRACE` before
creating module-level loggers. For a narrow filter, create the matching child
logger first:

```typescript
const db = createLogger("myapp").child("db")
using span = db.span?.("query") // enabled by TRACE=myapp:db
```

## Nested Spans

Spans automatically track parent-child relationships and share trace IDs:

```typescript
{
  using request = log.span?.("request", { path: "/api/users" })

  {
    using auth = request?.span("auth")
    await verifyToken()
  }

  {
    using db = request?.span("db:query")
    // db?.spanData.parentId === request.spanData.id
    // db?.spanData.traceId  === request.spanData.traceId
    await fetchUsers()
  }
}
```

Output:

```
SPAN myapp:auth (12ms) {}
SPAN myapp:db:query (45ms) {}
SPAN myapp:request (62ms) {path: "/api/users"}
```

## Span Data

Set custom attributes via `span.spanData`:

```typescript
{
  using span = log.span?.("batch")
  if (span) span.spanData.total = items.length

  for (const item of items) {
    await process(item)
    if (span) {
      span.spanData.processed = ((span.spanData.processed as number) ?? 0) + 1
    }
  }

  if (span) span.spanData.status = "complete"
}
```

### Read-only Properties

| Property    | Type             | Description                          |
| ----------- | ---------------- | ------------------------------------ |
| `id`        | `string`         | Unique span ID (`sp_1`, `sp_2`, ...) |
| `traceId`   | `string`         | Shared across nested spans           |
| `parentId`  | `string \| null` | Parent span ID                       |
| `startTime` | `number`         | Start timestamp (ms since epoch)     |
| `endTime`   | `number \| null` | End timestamp (null while running)   |
| `duration`  | `number`         | Live duration (computed on access)   |

## Manual End

For environments without `using` support:

```typescript
const span = log.span?.("operation")
try {
  await doWork()
  if (span) span.spanData.result = "success"
} finally {
  span?.end()
}
```

## Logging Within Spans

Spans are full loggers -- you can call `.info?.()`, `.debug?.()`, etc:

```typescript
{
  using span = log.span?.("import")
  span?.info?.("starting import")
  span?.debug?.("reading file")
  span?.warn?.("skipping malformed row", { row: 42 })
}
```

## JSON Output

Spans respect the output format. Set it via environment variable or config array:

```bash
TRACE=1 LOG_FORMAT=json bun run app
```

```typescript
const log = createLogger("myapp", [{ format: "json" }, console])
```

```json
{
  "time": "2026-01-15T14:32:16.456Z",
  "level": "span",
  "name": "myapp:import",
  "msg": "(1234ms)",
  "duration": 1234,
  "rowCount": 500
}
```
