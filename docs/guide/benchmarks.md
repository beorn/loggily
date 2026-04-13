# Benchmarks

Performance comparison of logging libraries.

**Test environment**: Bun 1.3.9, macOS arm64 (Apple Silicon), 10M iterations per test.

**Methodology**: All "enabled" benchmarks write to in-process noop sinks (no I/O syscalls) for a fair apples-to-apples comparison of formatting and serialization throughput:

- Loggily: config array with noop writable (no console)
- pino: `pino(opts, noopWritableStream)`
- winston: `Stream` transport with noop `Writable`

## Disabled Debug — Cheap Argument

When debug logging is disabled and arguments are cheap (string literals):

| Library         | ops/s | ns/op | Relative |
| --------------- | ----: | ----: | -------: |
| noop (baseline) |    3B |   0.4 |     1.0x |
| pino            |    2B |   0.5 |     1.3x |
| **Loggily**     |  383M |   2.6 |     6.5x |
| debug           |   43M |  23.4 |      59x |
| winston         |    3M | 391.2 |     978x |

Pino's level check is a simple integer comparison without Proxy overhead. Loggily's Proxy-based `?.` pattern adds ~2ns overhead for cheap args.

## Disabled Debug — Expensive Argument (the real story)

When debug logging is disabled but arguments require evaluation (JSON.stringify):

| Library         |    ops/s |   ns/op | Relative |
| --------------- | -------: | ------: | -------: |
| noop (baseline) |     414M |     2.4 |     1.0x |
| **Loggily**     | **248M** | **4.0** | **1.7x** |
| pino            |       8M |   133.1 |      55x |
| debug           |       7M |   153.3 |      64x |
| winston         |       1M |   774.6 |     323x |

**Loggily is ~22x faster** than conventional noop loggers for disabled calls with expensive arguments. The `?.` pattern skips argument evaluation entirely -- `log.debug?.(\`state: ${expensiveArg()}\`)` never calls `expensiveArg()` when debug is disabled.

This is the key insight: real-world logging often involves string interpolation, `JSON.stringify`, or computed values. The `?.` pattern eliminates this cost entirely.

## Enabled Info — Cheap Argument

When info logging is enabled, all loggers writing to noop sinks (fair comparison):

| Library     | ops/s | ns/op | Relative |
| ----------- | ----: | ----: | -------: |
| **Loggily** |    3M | 371.4 |     1.0x |
| pino        |    2M | 471.7 |     1.3x |
| winston     |    1M | 748.3 |     2.0x |

With a fair noop-sink comparison, Loggily is the fastest for enabled string logging.

## Enabled Info — Structured Data

Logging with structured data (`{ key: "value", count: 42 }`), all to noop sinks:

| Library     | ops/s |   ns/op | Relative |
| ----------- | ----: | ------: | -------: |
| **Loggily** |    1M |   668.9 |     1.0x |
| pino        |    1M |   738.2 |     1.1x |
| winston     |  587K | 1,703.6 |     2.5x |

Loggily and pino are neck-and-neck for structured data.

## Enabled Warn — Error Object

Logging with an Error object, all to noop sinks:

| Library     | ops/s |  ns/op | Relative |
| ----------- | ----: | -----: | -------: |
| **Loggily** |    1M |  990.9 |     1.0x |
| winston     |  839K | 1191.4 |     1.2x |
| pino        |  541K | 1848.4 |     1.9x |

Loggily handles Error objects fastest.

## Span Creation

Span create + dispose (no output):

| Library     | ops/s | ns/op |
| ----------- | ----: | ----: |
| **Loggily** |    2M | 544.1 |

~544ns per span lifecycle including ID generation, timing, and disposal.

## Key Takeaways

1. **Disabled + expensive args**: Loggily's `?.` pattern is ~22x faster than conventional noop loggers. The big win is specifically for disabled logging with expensive argument construction (string interpolation, JSON serialization, computed values). See [Benchmarks](/guide/benchmarks) for details.
2. **Disabled + cheap args**: Pino is faster due to no Proxy overhead. Both are sub-microsecond -- the difference is negligible in practice.
3. **Enabled + cheap args**: Loggily is ~1.3x faster than pino when both write to the same kind of noop sink.
4. **Enabled + structured data**: Loggily and pino are comparable.
5. **Enabled + Error objects**: Loggily is fastest.
6. **The `?.` advantage grows with argument cost**: The more expensive your log arguments, the bigger the win.

> **Note**: For max-throughput production logging with custom transports and worker-thread pipelines, Pino has a mature transport ecosystem. Loggily's biggest advantage is skipping work when logs are disabled. The right choice depends on which scenario matters most to your application.

## Reproducing

```bash
# Install benchmark dependencies
bun add -d pino winston debug @types/debug

# Run benchmarks
bun benchmarks/overhead.ts
```
