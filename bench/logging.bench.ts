/**
 * Loggily benchmarks — measures core logging operations.
 *
 * Run: bun bench/logging.bench.ts
 *
 * These benchmarks verify the zero-overhead promise:
 * - Disabled log levels should be ~0ns (optional chaining short-circuit)
 * - Enabled log levels should be fast (~1μs for console, less for noop)
 * - Spans should be efficient
 */

import { bench, run, group, summary } from "mitata"
import { createLogger, type ConditionalLogger } from "../src/index.ts"

// Suppress console output during benchmarks
const noop = () => {}
console.debug = noop
console.info = noop
console.warn = noop
console.error = noop

// Create loggers with different configs
const defaultLog = createLogger("bench")
const debugLog = createLogger("bench", [{ level: "debug" }, "console"])
const silentLog = createLogger("bench", [{ level: "silent" }, "console"])
const noopSink = { write: (_s: string) => {} }
const noopLog = createLogger("bench", [{ level: "trace" }, noopSink])

function expensiveArgs(): string {
  return JSON.stringify({ a: 1, b: 2, c: [1, 2, 3], d: { nested: true } })
}

// ---- Core logging operations ----

group("disabled log (should be ~0ns)", () => {
  summary(() => {
    bench("noop baseline", () => {})

    bench("debug?.() on info logger (cheap args)", () => {
      defaultLog.debug?.("cheap string")
    })

    bench("debug?.() on info logger (expensive args)", () => {
      defaultLog.debug?.(`expensive: ${expensiveArgs()}`)
    })

    bench("trace?.() on info logger", () => {
      defaultLog.trace?.("trace message")
    })

    bench("debug?.() on silent logger", () => {
      silentLog.debug?.("should not run")
    })
  })
})

group("disabled span (should match conditional logger baseline)", () => {
  summary(() => {
    bench("noop baseline", () => {})

    bench("debug?.() on info logger baseline", () => {
      defaultLog.debug?.("disabled")
    })

    bench("span?.() with TRACE off", () => {
      void defaultLog.span?.("op")
    })

    bench("span?.() with lazy props and TRACE off", () => {
      void defaultLog.span?.("op", () => ({ state: expensiveArgs() }))
    })
  })
})

group("enabled log (noop sink)", () => {
  summary(() => {
    bench("info?.() with string", () => {
      noopLog.info?.("simple message")
    })

    bench("info?.() with props", () => {
      noopLog.info?.("message", { count: 42, user: "alice" })
    })

    bench("info?.() with template literal", () => {
      noopLog.info?.(`count: ${42}`)
    })

    bench("error?.() with Error", () => {
      noopLog.error?.(new Error("test error"))
    })
  })
})

group("child logger creation", () => {
  summary(() => {
    bench("child(name)", () => {
      noopLog.child("sub")
    })

    bench("child(props)", () => {
      noopLog.child({ requestId: "abc-123" })
    })

    bench("child(name, props)", () => {
      noopLog.child("sub", { requestId: "abc-123" })
    })
  })
})

group("span lifecycle", () => {
  summary(() => {
    bench("span create + end", () => {
      const span = noopLog.span!("op")
      span.end()
    })

    bench("span with using", () => {
      {
        using span = noopLog.span!("op")
        void span
      }
    })

    bench("span with log + end", () => {
      const span = noopLog.span!("op")
      span.info?.("working")
      span.end()
    })
  })
})

group("pipeline dispatch", () => {
  summary(() => {
    const multiLog = createLogger("bench", [
      { level: "trace" },
      noopSink,
      [{ level: "error" }, noopSink],
    ])

    bench("single output", () => {
      noopLog.info?.("msg")
    })

    bench("branched output (2 sinks)", () => {
      multiLog.info?.("msg")
    })

    bench("with stage function", () => {
      const stageLog = createLogger("bench", [
        { level: "trace" },
        (e) => e,
        noopSink,
      ])
      stageLog.info?.("msg")
    })
  })
})

await run()
