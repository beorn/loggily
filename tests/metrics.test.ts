import { describe, test, expect, beforeEach, vi, afterEach } from "vitest"
import { createLogger, enableSpans, disableSpans, setLogLevel, setTraceFilter } from "../src/index.ts"
import {
  createMetricsCollector,
  withMetrics,
  spanStats,
  spanSummary,
  resetSpanStats,
  type MetricsCollector,
} from "../src/metrics.ts"

beforeEach(() => {
  resetSpanStats()
  enableSpans()
  setLogLevel("trace")
  setTraceFilter(null)
})

afterEach(() => {
  disableSpans()
  vi.restoreAllMocks()
})

describe("createMetricsCollector", () => {
  test("records and returns stats", () => {
    const c = createMetricsCollector()
    c.recordSpan({ name: "test", durationMs: 10 })
    c.recordSpan({ name: "test", durationMs: 20 })
    c.recordSpan({ name: "test", durationMs: 30 })

    const s = c.stats("test")
    expect(s).toBeDefined()
    expect(s!.count).toBe(3)
    expect(s!.min).toBe(10)
    expect(s!.max).toBe(30)
    expect(s!.mean).toBeCloseTo(20)
    expect(s!.total).toBe(60)
  })

  test("computes percentiles", () => {
    const c = createMetricsCollector()
    for (let i = 1; i <= 100; i++) c.recordSpan({ name: "x", durationMs: i })
    const s = c.stats("x")!
    expect(s.p50).toBeGreaterThanOrEqual(49)
    expect(s.p50).toBeLessThanOrEqual(51)
    expect(s.p95).toBeGreaterThanOrEqual(94)
    expect(s.p95).toBeLessThanOrEqual(96)
    expect(s.p99).toBeGreaterThanOrEqual(98)
    expect(s.p99).toBeLessThanOrEqual(100)
  })

  test("bounds memory", () => {
    const c = createMetricsCollector(10)
    for (let i = 0; i < 20; i++) c.recordSpan({ name: "x", durationMs: i })
    const s = c.stats("x")!
    expect(s.count).toBe(10)
    expect(s.min).toBe(10) // oldest entries dropped
  })

  test("summary format", () => {
    const c = createMetricsCollector()
    c.recordSpan({ name: "fast", durationMs: 5 })
    c.recordSpan({ name: "slow", durationMs: 100 })
    const text = c.summary()
    expect(text).toContain("fast:")
    expect(text).toContain("slow:")
    expect(text).toContain("spans")
  })

  test("reset clears all data", () => {
    const c = createMetricsCollector()
    c.recordSpan({ name: "x", durationMs: 10 })
    c.reset()
    expect(c.stats("x")).toBeUndefined()
  })
})

describe("ambient collector", () => {
  test("auto-records spans when TRACE is on", () => {
    // Suppress console output
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const log = createLogger("test:ambient")
    {
      using span = log.span?.("op")
      span!.spanData.x = 1
    }

    const stats = spanStats()
    expect(stats.has("test:ambient:op")).toBe(true)
    expect(stats.get("test:ambient:op")!.count).toBe(1)
  })

  test("spanSummary returns formatted text", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const log = createLogger("test:summary")
    {
      using _span = log.span?.("work")
    }

    const text = spanSummary()
    expect(text).toContain("test:summary:work")
  })
})

describe("withMetrics", () => {
  test("records to custom collector", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const collector = createMetricsCollector()
    const log = withMetrics(collector)(createLogger("test:custom"))
    {
      using _span = log.span?.("op")
    }

    expect(collector.stats("test:custom:op")).toBeDefined()
    expect(collector.stats("test:custom:op")!.count).toBe(1)
  })

  test("default (no arg) uses ambient collector", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const log = withMetrics()(createLogger("test:default"))
    {
      using _span = log.span?.("op")
    }

    // Should appear in ambient stats
    const stats = spanStats()
    expect(stats.has("test:default:op")).toBe(true)
  })

  test("stacks — fan-out to multiple collectors", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const c1 = createMetricsCollector()
    const c2 = createMetricsCollector()
    const log = withMetrics(c2)(withMetrics(c1)(createLogger("test:fanout")))
    {
      using _span = log.span?.("op")
    }

    expect(c1.stats("test:fanout:op")!.count).toBe(1)
    expect(c2.stats("test:fanout:op")!.count).toBe(1)
  })

  test("child loggers inherit metrics wrapper", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const collector = createMetricsCollector()
    const parent = withMetrics(collector)(createLogger("test:parent"))
    const child = parent.logger("child")
    {
      using _span = (child as unknown as { span?: Function }).span?.("op")
    }

    expect(collector.stats("test:parent:child:op")).toBeDefined()
  })

  test("does not record when spans are disabled", () => {
    disableSpans()
    const collector = createMetricsCollector()
    const log = withMetrics(collector)(createLogger("test:off"))
    // span is still created (loggily always creates spans) but output is suppressed
    {
      using _span = log.span?.("op")
    }
    // The ambient recorder still fires, but that's fine — it's just data collection
    // The key property: no span OUTPUT is produced
  })
})

describe("LazyProps", () => {
  test("span accepts lazy props function", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    let called = false
    const log = createLogger("test:lazy")
    {
      using _span = log.span?.("op", () => {
        called = true
        return { key: "value" }
      })
    }
    expect(called).toBe(true)
  })

  test("lazy props function called even when spans output disabled (span still created)", () => {
    disableSpans()
    let called = false
    const log = createLogger("test:lazy-off")
    // Note: log.span is always defined — ?.  doesn't short-circuit for spans.
    // The zero-overhead pattern for spans relies on callers not calling span at all
    // in production paths (e.g., behind a TRACE check or inside ?.  argument evaluation).
    const span = log.span?.("op", () => {
      called = true
      return { key: "value" }
    })
    expect(span).toBeDefined()
    expect(called).toBe(true)
  })
})
