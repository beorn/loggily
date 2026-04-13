# Near-Zero Cost Logging

Optional chaining skips argument evaluation when a level is disabled. For trivial arguments, the difference is negligible (~0.2ns). For expensive arguments (string interpolation, JSON serialization, computed values), the win is [**~22x**](/guide/benchmarks) because the work is never done.

## How It Works

`createLogger()` returns a `ConditionalLogger` -- a Proxy where disabled log levels return `undefined`:

```typescript
const log = createLogger("myapp")

// At default level (info):
typeof log.trace // undefined
typeof log.debug // undefined
typeof log.info // function
typeof log.warn // function
typeof log.error // function
```

Using `?.` means the entire call is skipped when the method is undefined:

```typescript
log.debug?.(`tree: ${JSON.stringify(buildTree())}`)
// buildTree() and JSON.stringify() NEVER run when debug is off
```

## Lazy Messages

For even more control, pass a function:

```typescript
log.debug?.(() => {
  const state = gatherComplexState()
  return `state: ${JSON.stringify(state)}`
})
// Function never called when debug is disabled
```

Type: `LazyMessage = string | (() => string)`

Both patterns work with all log levels and with structured data:

```typescript
log.trace?.(() => `verbose: ${expensiveComputation()}`, { extra: "data" })
```

## Dynamic Levels

The logger responds to level changes via the pipeline. With the default pipeline (no config array), levels are read from environment variables dynamically:

```typescript
import { createLogger } from "loggily"

// Default pipeline reads LOG_LEVEL from env
const log = createLogger("myapp")
```

With a config array, the level is set at creation time:

```typescript
const log = createLogger("myapp", [{ level: "debug" }, console])
log.debug // function (available)

const log2 = createLogger("myapp", [{ level: "error" }, console])
log2.debug // undefined
log2.info // undefined
```

## TypeScript Enforcement

TypeScript's type system makes `?.` mandatory:

```typescript
const log = createLogger("myapp")

log.debug("msg") // Type error: Object is possibly 'undefined'
log.debug?.("msg") // Correct
```

## Performance Numbers

See [Benchmarks](/guide/benchmarks) for detailed methodology and full results.

| Pattern           | Cheap args | Expensive args |
| ----------------- | ---------- | -------------- |
| Noop function     | 0.5 ns/op  | 57.6 ns/op     |
| Optional chaining | 0.7 ns/op  | **2.5 ns/op**  |
| Proxy + noop      | 2.8 ns/op  | 65.3 ns/op     |
| Proxy + `?.`      | 1.8 ns/op  | 5.9 ns/op      |

The Proxy overhead (~1ns) comes from `createLogger()` wrapping the base logger. For logging operations this is negligible compared to the actual I/O.

See [Benchmarks](/guide/benchmarks) for detailed methodology and results.
