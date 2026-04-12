# Async Context

Import from `loggily/context`. Node.js/Bun only.

Opt-in because it uses `AsyncLocalStorage`, which has a small runtime cost and isn't available in browsers.

## Quick Start

```typescript
import { enableContextPropagation } from "loggily/context"
import { createLogger } from "loggily"

enableContextPropagation()

const log = createLogger("myapp")
{
  using span = log.span("request")
  log.info?.("handling") // auto-tagged with trace_id, span_id

  // Child spans from ANY logger auto-parent via AsyncLocalStorage
  const db = createLogger("db")
  using dbSpan = db.span("query") // parentId = span.id
}
```

Once enabled, spans automatically parent to the current context span (even across different loggers), and log messages include `trace_id` and `span_id`.

## API

| Export | Description |
| --- | --- |
| `enableContextPropagation()` | Turn on AsyncLocalStorage tracking |
| `disableContextPropagation()` | Turn it off |
| `isContextPropagationEnabled()` | Check status |
| `getCurrentSpan()` | Get active `{ spanId, traceId, parentId }` or `null` |
| `runInSpanContext(ctx, fn)` | Run `fn` in a specific span context |
