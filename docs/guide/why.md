# Why Loggily?

## The Problem

Most apps end up with three logging tools: `debug` for local troubleshooting, a JSON logger for production, and ad-hoc timers for performance. Three APIs, three configs, three output formats. Loggily gives you one namespace tree and one output pipeline for all three.

But there's a deeper problem: most loggers waste work when logging is disabled. Even when `debug` level is off:

```typescript
// Pino, Winston, Bunyan
log.debug(`state: ${JSON.stringify(computeExpensiveState())}`)
```

`computeExpensiveState()` runs, `JSON.stringify()` runs, the string is concatenated -- all discarded because debug is off. In hot code paths (rendering loops, per-node operations), this adds up.

## The Solution

Loggily uses optional chaining to skip argument evaluation entirely:

```typescript
log.debug?.(`state: ${JSON.stringify(computeExpensiveState())}`)
```

When `debug` is disabled, `log.debug` is `undefined`. JavaScript's `?.` operator short-circuits: `computeExpensiveState()` never runs, `JSON.stringify()` never runs, the string is never built.

## Benchmarks

10M iterations, Bun 1.1.x, M1 Mac:

| Scenario                               | ops/s    | ns/op   |
| -------------------------------------- | -------- | ------- |
| Traditional noop (cheap args)          | 2168M    | 0.5     |
| Optional chaining (cheap args)         | 1406M    | 0.7     |
| Traditional noop (expensive args)      | 17M      | 57.6    |
| **Optional chaining (expensive args)** | **408M** | **2.5** |

For cheap arguments the overhead is ~0.2ns -- negligible. For expensive arguments, **22x faster**.

## Compared to Others

| Feature            | Loggily    | Pino  | Winston | debug |
| ------------------ | ---------- | ----- | ------- | ----- |
| Near-zero disabled | `?.` (22x) | noop  | noop    | check |
| Built-in spans     | Yes        | No    | No      | No    |
| Debug namespaces   | Yes        | No    | No      | Yes   |
| Structured JSON    | Yes        | Yes   | Yes     | No    |
| Bundle size        | ~3KB       | ~17KB | ~200KB+ | ~2KB  |
| TypeScript native  | Yes        | Types | Types   | Types |
| Worker threads     | Yes        | No    | No      | No    |

Loggily is a superset of `debug` — same namespace patterns, same `DEBUG=` env var — plus levels, structured data, spans, and JSON output. See [Comparison](/guide/comparison) for detailed analysis.

## Design Principles

1. **Logger = Span**: Every logger can become a span. No separate tracing library needed.
2. **Near-zero cost**: Disabled levels skip argument evaluation entirely via optional chaining.
3. **Minimal surface**: Few functions, each does one thing well.
4. **Type enforced**: TypeScript makes `?.` mandatory -- you can't accidentally call a disabled level.
5. **Structured**: JSON in production, readable console in development.
