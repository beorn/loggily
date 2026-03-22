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
  enableSpans,
  disableSpans,
  setLogLevel,
  setLogFormat,
  setOutputMode,
  resetIds,
  setTraceFilter,
  setDebugFilter,
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
const parseJSON = (s: string): Record<string, any> => JSON.parse(s) as Record<string, any>

let consoleMock: ReturnType<typeof createConsoleMock>

beforeEach(() => {
  resetIds()
  setLogLevel("trace")
  disableSpans()
  setTraceFilter(null)
  setDebugFilter(null)
  setOutputMode("console")
  setLogFormat("console")
  setIdFormat("simple")
  setSampleRate(1.0)
  disableContextPropagation()
  consoleMock = createConsoleMock()
})

afterEach(() => {
  vi.restoreAllMocks()
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
    const span = log.span("work")

    expect(span.spanData.id).toBe("sp_1")
    expect(span.spanData.traceId).toBe("tr_1")
    span.end()
  })

  test("W3C format produces hex IDs of correct length", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span("work")

    // Span ID: 16 hex chars
    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    // Trace ID: 32 hex chars
    expect(span.spanData.traceId).toMatch(/^[0-9a-f]{32}$/)
    span.end()
  })

  test("W3C IDs are unique", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span1 = log.span("a")
    const span2 = log.span("b")

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
    const span = log.span("work")
    expect(span.spanData.id).toMatch(/^[0-9a-f]{16}$/)
    span.end()

    setIdFormat("simple")
    resetIds()
    const span2 = log.span("work2")
    expect(span2.spanData.id).toBe("sp_1")
    span2.end()
  })

  test("nested spans share trace ID in W3C format", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const parent = log.span("parent")
    const child = parent.span("child")

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
    const span = log.span("request")

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
    const span = log.span("request")

    const header = traceparent(span.spanData)
    // Should still produce valid traceparent format
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)

    span.end()
  })

  test("emits 01 (sampled) by default", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span("request")

    const header = traceparent(span.spanData)
    expect(header).toMatch(/-01$/)

    span.end()
  })

  test("emits 00 (not sampled) when sampled=false", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span("request")

    const header = traceparent(span.spanData, { sampled: false })
    expect(header).toMatch(/-00$/)

    span.end()
  })

  test("emits 01 (sampled) when sampled=true explicitly", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span("request")

    const header = traceparent(span.spanData, { sampled: true })
    expect(header).toMatch(/-01$/)

    span.end()
  })

  test("traceparent can be used as HTTP header", () => {
    setIdFormat("w3c")
    const log = createLogger("test")
    const span = log.span("request")

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
      using span = log.span("request")
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
      using span = log.span("request")
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
      using parentSpan = log.span("parent")
      // A span created by a DIFFERENT logger still gets parented
      // because of AsyncLocalStorage context
      const childSpan = log2.span("child")

      expect(childSpan.spanData.parentId).toBe(parentSpan.spanData.id)
      expect(childSpan.spanData.traceId).toBe(parentSpan.spanData.traceId)

      childSpan.end()
    }
  })

  test("context propagation works across async boundaries", async () => {
    enableContextPropagation()
    const log = createLogger("test")

    const span = log.span("async-parent")

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

    const ctx = { spanId: "custom-span", traceId: "custom-trace", parentId: null }

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
      using span = log.span("request")
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
    enableSpans()
    setSampleRate(0.0)
    const log = createLogger("test")

    for (let i = 0; i < 10; i++) {
      using span = log.span(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("sample rate 1.0 keeps all span output", () => {
    enableSpans()
    setSampleRate(1.0)
    const log = createLogger("test")

    for (let i = 0; i < 5; i++) {
      using span = log.span(`work-${i}`)
    }

    expect(consoleMock.findSpans()).toHaveLength(5)
  })

  test("sampling is head-based: decided at trace creation", () => {
    enableSpans()
    setSampleRate(0.0)
    const log = createLogger("test")

    // Create a root span — should be unsampled (rate=0)
    const root = log.span("root")
    // Reset rate — but sampling decision was already made
    setSampleRate(1.0)
    // Child spans inherit parent's sampling decision
    {
      using child = root.span("child")
    }
    root.end()

    // Even though rate is now 1.0, the root was created at 0.0
    expect(consoleMock.findSpans()).toHaveLength(0)
  })

  test("child spans are always sampled when parent is sampled", () => {
    enableSpans()
    setSampleRate(1.0)
    const log = createLogger("test")

    const root = log.span("root")
    // Lower rate after root creation — children should still be sampled
    setSampleRate(0.0)
    {
      using child = root.span("child")
    }
    root.end()

    // Root was sampled at 1.0, child inherits
    expect(consoleMock.findSpans()).toHaveLength(2)
  })

  test("partial sample rate produces some output", () => {
    enableSpans()
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
      using span = log.span(`work-${i}`)
    }

    // With alternating random values and 0.5 rate: 2 sampled, 2 not
    expect(consoleMock.findSpans()).toHaveLength(2)
  })

  test("span data is still available even when not sampled", () => {
    setSampleRate(0.0)
    const log = createLogger("test")
    const span = log.span("work")

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
    setLogFormat("json")
    const log = createLogger("test")

    {
      using span = log.span("request")
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
    setLogFormat("json")
    const log = createLogger("test")

    {
      using span = log.span("request")
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
    setLogFormat("json")
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
      using span = log.span("request")
      log.info?.("tagged message")

      const output = consoleMock.output.find((o) => o.message.includes("tagged message"))
      expect(output).toBeDefined()
      expect(output!.message).toContain("trace_id")
      expect(output!.message).toContain("span_id")
    }
  })

  test("per-call data overrides context tags", () => {
    enableContextPropagation()
    setLogFormat("json")
    const log = createLogger("test")

    {
      using span = log.span("request")
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
// Integration: Multiple features together
// ─────────────────────────────────────────────────────────────────────────────

describe("integration", () => {
  test("W3C IDs + traceparent + context propagation", () => {
    setIdFormat("w3c")
    enableContextPropagation()
    const log = createLogger("test")

    {
      using span = log.span("request")
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
    enableSpans()
    setSampleRate(1.0)
    setLogFormat("json")
    const log = createLogger("test")

    {
      using span = log.span("sampled")
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
