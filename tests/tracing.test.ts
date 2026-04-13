/**
 * Tests for distributed tracing features:
 * 1. Configurable ID format (simple vs W3C)
 * 2. traceparent() header formatting
 * 3. AsyncLocalStorage context propagation
 * 4. Head-based sampling
 * 5. Auto-tagging logs with trace/span ID from context
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  createLogger,
  resetIds,
  setIdFormat,
  getIdFormat,
  traceparent,
  setSampleRate,
  getSampleRate,
} from "../src/index.ts"
import {
  enableContextPropagation,
  disableContextPropagation,
  getCurrentSpan,
  isContextPropagationEnabled,
  runInSpanContext,
} from "../src/context.ts"
import { createConsoleMock } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseJSON = (s: string): Record<string, any> =>
  JSON.parse(s) as Record<string, any>

let consoleMock: ReturnType<typeof createConsoleMock>

// Save/restore env vars
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  resetIds()
  savedEnv = {
    TRACE: process.env.TRACE,
    DEBUG: process.env.DEBUG,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_FORMAT: process.env.LOG_FORMAT,
    TRACE_FORMAT: process.env.TRACE_FORMAT,
    TRACE_ID_FORMAT: process.env.TRACE_ID_FORMAT,
    TRACE_SAMPLE_RATE: process.env.TRACE_SAMPLE_RATE,
    NODE_ENV: process.env.NODE_ENV,
  }
  // Clean env so tests start from a known state
  delete process.env.TRACE
  delete process.env.DEBUG
  delete process.env.LOG_FORMAT
  delete process.env.TRACE_FORMAT
  delete process.env.TRACE_ID_FORMAT
  delete process.env.TRACE_SAMPLE_RATE
  delete process.env.NODE_ENV
  process.env.LOG_LEVEL = "trace"
  setIdFormat("simple")
  setSampleRate(1.0)
  disableContextPropagation()
  consoleMock = createConsoleMock()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Restore env
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Configurable ID Format
// ─────────────────────────────────────────────────────────────────────────────

describe("ID format", () => {
  test("default format is simple", () => {
    expect(getIdFormat()).toBe("simple")
  })

  test("simple format produces sp_N and tr_N IDs", () => {
    setIdFormat("simple")
    const log = createLogger("test")
    const span = log.span!("work")

    expect(span.spanData.id).toBe("sp_1")
    expect(span.spanData.traceId).toBe("tr_1")
    span.end()
  })

  test("W3C format produces hex IDs of correct length", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("work")

    // Span ID: 16 hex chars
    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    // Trace ID: 32 hex chars
    expect(span.spanData.traceId).toMatch(/^[0-9a-f]{32}$/)
    span.end()
  })

  test("W3C IDs are unique", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span1 = log.span!("a")
    const span2 = log.span!("b")

    expect(span1.spanData.id).not.toBe(span2.spanData.id)
    // Different root spans get different trace IDs
    expect(span1.spanData.traceId).not.toBe(span2.spanData.traceId)

    span1.end()
    span2.end()
  })

  test("setIdFormat switches between formats", () => {
    setIdFormat("simple")
    expect(getIdFormat()).toBe("simple")

    setIdFormat("w3c")
    expect(getIdFormat()).toBe("w3c")

    const log = createLogger("test")
    const span = log.span!("work")
    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    span.end()

    setIdFormat("simple")
    resetIds()
    const span2 = log.span!("work2")
    expect(span2.spanData.id).toBe("sp_1")
    span2.end()
  })

  test("nested spans share trace ID in W3C format", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const parent = log.span!("parent")
    const child = parent.span!("child")

    expect(child.spanData.traceId).toBe(parent.spanData.traceId)
    expect(child.spanData.parentId).toBe(parent.spanData.id)

    child.end()
    parent.end()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. traceparent() Header
// ─────────────────────────────────────────────────────────────────────────────

describe("traceparent()", () => {
  test("formats W3C traceparent header with W3C IDs", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData)
    // Format: 00-{32 hex}-{16 hex}-01
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)

    // Verify it contains the actual IDs
    const parts = header.split("-")
    expect(parts[0]).toBe("00") // version
    expect(parts[1]).toBe(span.spanData.traceId)
    expect(parts[2]).toBe(span.spanData.id)
    expect(parts[3]).toBe("01") // sampled flag

    span.end()
  })

  test("formats traceparent from simple IDs (zero-padded)", () => {
    setIdFormat("simple")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData)
    // Should still produce valid traceparent format
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)

    span.end()
  })

  test("emits 01 (sampled) by default", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData)
    expect(header).toMatch(/-01$/)

    span.end()
  })

  test("emits 00 (not sampled) when sampled=false", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData, { sampled: false })
    expect(header).toMatch(/-00$/)

    span.end()
  })

  test("emits 01 (sampled) when sampled=true explicitly", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData, { sampled: true })
    expect(header).toMatch(/-01$/)

    span.end()
  })

  test("traceparent can be used as HTTP header", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span!("request")

    const header = traceparent(span.spanData)

    // Simulate setting as HTTP header
    const headers = new Headers()
    headers.set("traceparent", header)
    expect(headers.get("traceparent")).toBe(header)

    span.end()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. AsyncLocalStorage Context Propagation
// ─────────────────────────────────────────────────────────────────────────────

describe("context propagation", () => {
  test("disabled by default", () => {
    expect(isContextPropagationEnabled()).toBe(false)
    expect(getCurrentSpan()).toBeNull()
  })

  test("enableContextPropagation enables it", () => {
    enableContextPropagation()
    expect(isContextPropagationEnabled()).toBe(true)
  })

  test("disableContextPropagation disables it", () => {
    enableContextPropagation()
    disableContextPropagation()
    expect(isContextPropagationEnabled()).toBe(false)
  })

  test("getCurrentSpan returns null when no span is active", () => {
    enableContextPropagation()
    expect(getCurrentSpan()).toBeNull()
  })

  test("getCurrentSpan returns current span context within a span", () => {
    enableContextPropagation()
    const log = createLogger("test")

    {
      using span = log.span!("request")
      const current = getCurrentSpan()

      expect(current).not.toBeNull()
      expect(current!.spanId).toBe(span.spanData.id)
      expect(current!.traceId).toBe(span.spanData.traceId)
    }
  })

  test("getCurrentSpan returns null after span ends", () => {
    enableContextPropagation()
    const log = createLogger("test")

    {
      using span = log.span!("request")
      expect(getCurrentSpan()).not.toBeNull()
    }

    // After span disposal, context should be cleared
    expect(getCurrentSpan()).toBeNull()
  })

  test("nested spans auto-parent via context", () => {
    enableContextPropagation()
    const log = createLogger("test")
    // Create a separate logger that doesn't share span hierarchy
    const log2 = createLogger("other")

    {
      using parentSpan = log.span!("parent")
      // A span created by a DIFFERENT logger still gets parented
      // because of AsyncLocalStorage context
      const childSpan = log2.span!("child")

      expect(childSpan.spanData.parentId).toBe(parentSpan.spanData.id)
      expect(childSpan.spanData.traceId).toBe(parentSpan.spanData.traceId)

      childSpan.end()
    }
  })

  test("context propagation works across async boundaries", async () => {
    enableContextPropagation()
    const log = createLogger("test")

    const span = log.span!("async-parent")

    // Simulate async work
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const current = getCurrentSpan()
        expect(current).not.toBeNull()
        expect(current!.spanId).toBe(span.spanData.id)
        resolve()
      }, 10)
    })

    span.end()
  })

  test("runInSpanContext scopes context to callback", () => {
    enableContextPropagation()

    const ctx = {
      spanId: "custom-span",
      traceId: "custom-trace",
      parentId: null,
    }

    const result = runInSpanContext(ctx, () => {
      const current = getCurrentSpan()
      expect(current).not.toBeNull()
      expect(current!.spanId).toBe("custom-span")
      expect(current!.traceId).toBe("custom-trace")
      return 42
    })

    expect(result).toBe(42)
  })

  test("context propagation is no-op when disabled", () => {
    // Don't enable context propagation
    const log = createLogger("test")

    {
      using span = log.span!("request")
      expect(getCurrentSpan()).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Head-Based Sampling
// ─────────────────────────────────────────────────────────────────────────────

describe("sampling", () => {
  test("default sample rate is 1.0 (everything sampled)", () => {
    expect(getSampleRate()).toBe(1.0)
  })

  test("setSampleRate validates range", () => {
    expect(() => setSampleRate(-0.1)).toThrow("between 0.0 and 1.0")
    expect(() => setSampleRate(1.1)).toThrow("between 0.0 and 1.0")
  })

  test("sample rate 0.0 suppresses all span output", () => {
    process.env.TRACE = "1"
    setSampleRate(0.0)
    const log = createLogger("test")

    for (let i = 0; i < 10; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("sample rate 1.0 keeps all span output", () => {
    process.env.TRACE = "1"
    setSampleRate(1.0)
    const log = createLogger("test")

    for (let i = 0; i < 5; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(5)
  })

  test("sampling is head-based: decided at trace creation", () => {
    process.env.TRACE = "1"
    setSampleRate(0.0)
    const log = createLogger("test")

    // Create a root span — should be unsampled (rate=0)
    const root = log.span!("root")
    // Reset rate — but sampling decision was already made
    setSampleRate(1.0)
    // Child spans inherit parent's sampling decision
    {
      using child = root.span!("child")
    }
    root.end()

    // Even though rate is now 1.0, the root was created at 0.0
    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("child spans are always sampled when parent is sampled", () => {
    process.env.TRACE = "1"
    setSampleRate(1.0)
    const log = createLogger("test")

    const root = log.span!("root")
    // Lower rate after root creation — children should still be sampled
    setSampleRate(0.0)
    {
      using child = root.span!("child")
    }
    root.end()

    // Root was sampled at 1.0, child inherits
    expect(consoleMock.findSpans()).toHaveLength(2)
  })

  test("partial sample rate produces some output", () => {
    process.env.TRACE = "1"
    setSampleRate(0.5)

    // Use seeded random for deterministic test
    let callCount = 0
    vi.spyOn(Math, "random").mockImplementation(() => {
      callCount++
      // Alternate: 0.3 (sampled), 0.7 (not sampled), 0.3, 0.7, ...
      return callCount % 2 === 1 ? 0.3 : 0.7
    })

    const log = createLogger("test")

    for (let i = 0; i < 4; i++) {
      using span = log.span!(`work-${i}`)
    }

    // With alternating random values and 0.5 rate: 2 sampled, 2 not
    expect(consoleMock.findSpans()).toHaveLength(2)
  })

  test("span data is still available even when not sampled", () => {
    setSampleRate(0.0)
    const log = createLogger("test")
    const span = log.span!("work")

    // spanData should still work — sampling only affects output
    span.spanData.count = 42
    expect(span.spanData.count).toBe(42)
    expect(span.spanData.id).toBeDefined()
    expect(span.spanData.traceId).toBeDefined()

    span.end()
    expect(span.spanData.duration).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Auto-Tagging Logs with Context
// ─────────────────────────────────────────────────────────────────────────────

describe("auto-tagging with context", () => {
  test("logs include trace_id and span_id when context is active", () => {
    enableContextPropagation()
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test")

    {
      using span = log.span!("request")
      log.info?.("inside span")

      const output = consoleMock.output.find((o) => {
        try {
          const parsed = parseJSON(o.message)
          return parsed.msg === "inside span"
        } catch {
          return false
        }
      })
      expect(output).toBeDefined()

      const parsed = parseJSON(output!.message)
      expect(parsed.trace_id).toBe(span.spanData.traceId)
      expect(parsed.span_id).toBe(span.spanData.id)
    }
  })

  test("logs do NOT include trace_id/span_id without context propagation", () => {
    // Context propagation disabled by default
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test")

    {
      using span = log.span!("request")
      log.info?.("no context")

      const output = consoleMock.output.find((o) => {
        try {
          const parsed = parseJSON(o.message)
          return parsed.msg === "no context"
        } catch {
          return false
        }
      })
      expect(output).toBeDefined()

      const parsed = parseJSON(output!.message)
      expect(parsed.trace_id).toBeUndefined()
      expect(parsed.span_id).toBeUndefined()
    }
  })

  test("logs outside a span have no trace tags", () => {
    enableContextPropagation()
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test")

    log.info?.("outside span")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.trace_id).toBeUndefined()
    expect(parsed.span_id).toBeUndefined()
  })

  test("auto-tags work with console format too", () => {
    enableContextPropagation()
    const log = createLogger("test")

    {
      using span = log.span!("request")
      log.info?.("tagged message")

      const output = consoleMock.output.find((o) =>
        o.message.includes("tagged message"),
      )
      expect(output).toBeDefined()
      expect(output!.message).toContain("trace_id")
      expect(output!.message).toContain("span_id")
    }
  })

  test("per-call data overrides context tags", () => {
    enableContextPropagation()
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test")

    {
      using span = log.span!("request")
      log.info?.("override test", { trace_id: "custom-trace" })

      const output = consoleMock.output.find((o) => {
        try {
          const parsed = parseJSON(o.message)
          return parsed.msg === "override test"
        } catch {
          return false
        }
      })

      const parsed = parseJSON(output!.message)
      // Per-call data wins over context
      expect(parsed.trace_id).toBe("custom-trace")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5b. Env Vars and Config Object for ID Format / Sample Rate
// ─────────────────────────────────────────────────────────────────────────────

describe("TRACE_ID_FORMAT env var", () => {
  test("TRACE_ID_FORMAT=w3c sets W3C format via withEnvDefaults", () => {
    process.env.TRACE_ID_FORMAT = "w3c"
    const log = createLogger("test")
    const span = log.span!("work")

    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    expect(span.spanData.traceId).toMatch(/^[0-9a-f]{32}$/)
    span.end()
  })

  test("TRACE_ID_FORMAT=simple keeps simple format", () => {
    process.env.TRACE_ID_FORMAT = "simple"
    const log = createLogger("test")
    const span = log.span!("work")

    expect(span.spanData.id).toBe("sp_1")
    expect(span.spanData.traceId).toBe("tr_1")
    span.end()
  })

  test("TRACE_ID_FORMAT is case-insensitive", () => {
    process.env.TRACE_ID_FORMAT = "W3C"
    const log = createLogger("test")
    const span = log.span!("work")

    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    span.end()
  })

  test("invalid TRACE_ID_FORMAT is ignored", () => {
    process.env.TRACE_ID_FORMAT = "bogus"
    const log = createLogger("test")
    const span = log.span!("work")

    // Falls back to simple (the default)
    expect(span.spanData.id).toBe("sp_1")
    span.end()
  })

  afterEach(() => {
    delete process.env.TRACE_ID_FORMAT
  })
})

describe("TRACE_SAMPLE_RATE env var", () => {
  test("TRACE_SAMPLE_RATE=0.0 suppresses all span output", () => {
    process.env.TRACE = "1"
    process.env.TRACE_SAMPLE_RATE = "0.0"
    const log = createLogger("test")

    for (let i = 0; i < 5; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("TRACE_SAMPLE_RATE=1.0 keeps all span output", () => {
    process.env.TRACE = "1"
    process.env.TRACE_SAMPLE_RATE = "1.0"
    const log = createLogger("test")

    for (let i = 0; i < 5; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(5)
  })

  test("invalid TRACE_SAMPLE_RATE is ignored", () => {
    process.env.TRACE = "1"
    process.env.TRACE_SAMPLE_RATE = "not-a-number"
    // Should not throw, falls back to default (1.0)
    const log = createLogger("test")

    for (let i = 0; i < 3; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(3)
  })

  test("out-of-range TRACE_SAMPLE_RATE is ignored", () => {
    process.env.TRACE = "1"
    process.env.TRACE_SAMPLE_RATE = "2.0"
    // Out of range, should be ignored — default 1.0
    const log = createLogger("test")

    for (let i = 0; i < 3; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(3)
  })

  afterEach(() => {
    delete process.env.TRACE_SAMPLE_RATE
  })
})

describe("config object idFormat", () => {
  test("{ idFormat: 'w3c' } in config array sets W3C format", () => {
    const log = createLogger("test", [
      { level: "trace", idFormat: "w3c" },
      console,
    ])
    const span = log.span!("work")

    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    expect(span.spanData.traceId).toMatch(/^[0-9a-f]{32}$/)
    span.end()
  })

  test("{ idFormat: 'simple' } in config array sets simple format", () => {
    // First set to W3C, then override via config
    setIdFormat("w3c")
    const log = createLogger("test", [
      { level: "trace", idFormat: "simple" },
      console,
    ])
    const span = log.span!("work")

    expect(span.spanData.id).toBe("sp_1")
    span.end()
  })
})

describe("config object sampleRate", () => {
  test("{ sampleRate: 0.0 } in config array suppresses all spans", () => {
    const log = createLogger("test", [
      { level: "trace", sampleRate: 0.0 },
      console,
    ])
    process.env.TRACE = "1"

    for (let i = 0; i < 5; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("{ sampleRate: 1.0 } in config array keeps all spans", () => {
    const log = createLogger("test", [
      { level: "trace", sampleRate: 1.0 },
      console,
    ])
    process.env.TRACE = "1"

    for (let i = 0; i < 5; i++) {
      using span = log.span!(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(5)
  })

  test("{ sampleRate: ... } validates range", () => {
    expect(() => {
      createLogger("test", [{ level: "trace", sampleRate: -0.1 }, console])
    }).toThrow("between 0.0 and 1.0")

    expect(() => {
      createLogger("test", [{ level: "trace", sampleRate: 1.5 }, console])
    }).toThrow("between 0.0 and 1.0")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Integration: Multiple features together
// ─────────────────────────────────────────────────────────────────────────────

describe("integration", () => {
  test("W3C IDs + traceparent + context propagation", () => {
    setIdFormat("w3c")
    enableContextPropagation()
    const log = createLogger("test")

    {
      using span = log.span!("request")
      const header = traceparent(span.spanData)

      // Valid W3C traceparent
      expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)

      // Context is set
      const current = getCurrentSpan()
      expect(current).not.toBeNull()
      expect(current!.spanId).toBe(span.spanData.id)
    }
  })

  test("sampling + context propagation", () => {
    enableContextPropagation()
    process.env.TRACE = "1"
    setSampleRate(1.0)
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test")

    {
      using span = log.span!("sampled")
      log.info?.("in sampled span")
    }

    // Span output exists (JSON format uses lowercase "span" as level)
    const spanOutput = consoleMock.output.find((o) => {
      try {
        return parseJSON(o.message).level === "span"
      } catch {
        return false
      }
    })
    expect(spanOutput).toBeDefined()

    // Log was auto-tagged
    const logOutput = consoleMock.output.find((o) => {
      try {
        return parseJSON(o.message).msg === "in sampled span"
      } catch {
        return false
      }
    })
    expect(logOutput).toBeDefined()
    const parsed = parseJSON(logOutput!.message)
    expect(parsed.trace_id).toBeDefined()
    expect(parsed.span_id).toBeDefined()
  })
})
