---
layout: home

hero:
  name: "Loggily"
  text: "Debugs, logs, and spans — one API"
  tagline: "Clarity without the clutter. One namespace tree. One output pipeline. One ?. pattern for near-zero overhead. Pure TypeScript. ~3KB. Zero dependencies."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/journey
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/loggily

features:
  - title: One Unified Pipeline
    details: "Most projects juggle debug for dev output, a JSON logger for production, and a tracing SDK for timings — three configs, three formats, three APIs. Loggily integrates all three: one namespace tree, one output pipeline, one import."
  - title: "Near-Zero Cost via ?."
    details: "Optional chaining skips the entire call — including argument evaluation — when a level is disabled. In benchmarks with expensive disabled log arguments, ~22x faster than a conventional noop logger."
  - title: "Debug-Style Namespaces"
    details: "Namespace filtering with DEBUG=myapp,-myapp:noisy. Uses native console methods so source lines stay clickable in DevTools. Compatible with the same patterns as the debug package."
  - title: "Structured Logs"
    details: "Colorized console with timestamps and clickable source lines in development. Structured JSON in production. Same code, same API — output format switches automatically."
  - title: "Lightweight Spans"
    details: "Built-in spans with automatic timing, parent-child tracking, and trace IDs. Uses TC39 Explicit Resource Management (using) for automatic cleanup."
  - title: "Composable Config Pipeline"
    details: "Configure with a single array: objects set options, arrays branch, values write. Pass console for terminal output, { file } for file output, or functions for custom stages."
  - title: "~3KB, Zero Dependencies"
    details: "No external dependencies. Native TypeScript, ESM-only. Runs on Node.js 23.6+, Bun 1.0+, and browsers."
---

> Early release (0.x) — API may evolve before 1.0.

## Quick Start

::: code-group

```bash [npm]
npm install loggily
```

```bash [bun]
bun add loggily
```

```bash [pnpm]
pnpm add loggily
```

```bash [yarn]
yarn add loggily
```

:::

```typescript
import { createLogger } from "loggily"

const log = createLogger("myapp", [{ level: "debug" }, console])

// ?. skips the entire call — including argument evaluation — when the level is disabled
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))
```

### Spans

```typescript
// With `using` (TS 5.2+, Bun 1.0+, Node 23.6+)
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// SPAN myapp:db:query (45ms) {count: 100, table: "users"}

// Without `using` — call .end() manually
const span = log.span("db:query", { table: "users" })
try {
  /* ... */
} finally {
  span.end()
}
```
