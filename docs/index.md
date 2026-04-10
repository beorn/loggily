---
layout: home

hero:
  name: "Loggily"
  text: "Clarity without the clutter"
  tagline: "One library. One namespace tree. One output pipeline. For logs (structured JSON or console), debug(), and tracing spans. Near-zero overhead from disabled log levels. Pure TypeScript. ~3KB. Zero dependencies."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/journey
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/loggily

features:
  - title: "Debug Logging"
    details: "debug-compatible namespace filtering with DEBUG=myapp,-myapp:noisy. Uses native console methods so source lines stay clickable in DevTools."
  - title: "Structured Logs"
    details: "Colorized console with timestamps and clickable source lines in development. Structured JSON in production. Same code, same API — output format switches automatically."
  - title: "Lightweight Spans"
    details: "Built-in spans with automatic timing, parent-child tracking, and trace IDs. For full OpenTelemetry interoperability, use OpenTelemetry."
  - title: Near-Zero Cost via ?.
    details: "Optional chaining skips the entire call — including argument evaluation — when a level is disabled. The big win is disabled logging with expensive arguments (string interpolation, serialization) — typically 10x+ faster."
  - title: ~3KB, Zero Dependencies
    details: "No external dependencies. Native TypeScript, ESM-only. Runs on Node.js 23.6+, Bun 1.0+, and browsers."
  - title: One Unified Pipeline
    details: "Many projects end up with separate tools for debug output, production logs, and tracing — three configs, three formats, three APIs. Loggily integrates all three: one namespace tree, one output pipeline, one import."
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

const log = createLogger("myapp")

// ?. skips the entire call — including argument evaluation — when the level is disabled
log.info?.("server started", { port: 3000 })
log.debug?.("cache hit", { key: "user:42" })
log.error?.(new Error("connection lost"))
```

### Spans

```typescript
// With `using` (TS 5.2+, Bun 1.0+, Node 22+)
{
  using span = log.span("db:query", { table: "users" })
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
}
// Output: SPAN myapp:db:query (45ms) {count: 100, table: "users"}

// Without `using` — call .end() manually
const span = log.span("db:query", { table: "users" })
try {
  const users = await db.query("SELECT * FROM users")
  span.spanData.count = users.length
} finally {
  span.end()
}
```
